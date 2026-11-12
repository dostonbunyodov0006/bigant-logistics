package expo.modules.gpsguard

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The driver's position on shift, taken and sent by the phone itself (owner,
 * 05.11.2026). The JavaScript service before it went quiet the moment the
 * phone lay still with its screen off — 12 to 33 minutes with nothing — and
 * the trip back from a region could not be told from the trail.
 *
 * A foreground service of its own: it keeps the processor awake for the shift
 * (with the battery "unrestricted" permission Android lets it), takes a fix
 * every five minutes straight from the GPS, and posts it to the server with
 * the driver's location key — no app, no JavaScript, no login. A fix that
 * cannot be sent is kept and goes with the next one. The server's answer says
 * when the shift is over, and the service stops itself.
 */
class BigantLocationService : Service() {
  companion object {
    private const val PREFS = "bigant.location"
    private const val CHANNEL = "bigant_shift_location"
    private const val NOTIFICATION_ID = 47110
    private const val MAX_QUEUED = 2000
    private const val STALE_FIX_MS = 15 * 60_000L

    fun start(context: Context, baseUrl: String, key: String, intervalMs: Long) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("base", baseUrl.trimEnd('/'))
        .putString("key", key)
        .putLong("interval", intervalMs.coerceAtLeast(60_000L))
        .putBoolean("active", true)
        .apply()
      val intent = Intent(context, BigantLocationService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    /** Back on with the key it already has; false when it has none yet. */
    fun resume(context: Context): Boolean {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      if (p.getString("key", null).isNullOrEmpty() || p.getString("base", null).isNullOrEmpty()) return false
      p.edit().putBoolean("active", true).apply()
      val intent = Intent(context, BigantLocationService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      return true
    }

    /** Signed out: the key goes with him. */
    fun forget(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
      context.stopService(Intent(context, BigantLocationService::class.java))
    }

    fun stop(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("active", false).apply()
      context.stopService(Intent(context, BigantLocationService::class.java))
    }

    /**
     * Sends what is kept, now, and says whether nothing is left (owner,
     * 05.11.2026): "Ishni tugatish" first puts the road on the server, then
     * ends the shift, so the evening extra is worked out with it.
     */
    fun flush(context: Context): Boolean {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val q = try {
        JSONArray(p.getString("queue", "[]"))
      } catch (_: Throwable) {
        JSONArray()
      }
      if (q.length() == 0) return true
      val base = p.getString("base", null) ?: return true
      val key = p.getString("key", null) ?: return true
      var conn: HttpURLConnection? = null
      return try {
        conn = (URL("$base/drivers/location/ingest").openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"
          connectTimeout = 20_000
          readTimeout = 20_000
          doOutput = true
          setRequestProperty("Content-Type", "application/json")
          setRequestProperty("x-location-key", key)
        }
        conn.outputStream.use { it.write(body(q)) }
        val code = conn.responseCode
        if (code in 200..299 || code == 400 || code == 401) {
          dropSent(p, q.length())
          true
        } else {
          false
        }
      } catch (_: Throwable) {
        false
      } finally {
        conn?.disconnect()
      }
    }

    /** One lock for the kept road: the service adds to it on its thread while the app sends it on another. */
    private val QUEUE_LOCK = Any()

    /**
     * The points with the phone's clock at the moment of sending (owner,
     * 06.11.2026): the server measures a clock set wrong by hand against its own.
     */
    fun body(q: JSONArray): ByteArray =
      JSONObject().put("points", q).put("sent_at", isoUtc(System.currentTimeMillis())).toString().toByteArray()

    fun isoUtc(ms: Long): String {
      val f = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
      f.timeZone = java.util.TimeZone.getTimeZone("UTC")
      return f.format(java.util.Date(ms))
    }

    /**
     * Takes off only the points that were sent (owner, 06.11.2026): writing
     * "[]" after a send also wiped a fix the service kept while it was on the way.
     */
    fun dropSent(p: android.content.SharedPreferences, sent: Int) = synchronized(QUEUE_LOCK) {
      val q = try {
        JSONArray(p.getString("queue", "[]"))
      } catch (_: Throwable) {
        JSONArray()
      }
      val rest = JSONArray()
      for (i in minOf(sent, q.length()) until q.length()) rest.put(q.get(i))
      p.edit().putString("queue", rest.toString()).commit()
    }

    fun withQueue(p: android.content.SharedPreferences, change: (JSONArray) -> JSONArray) = synchronized(QUEUE_LOCK) {
      val q = try {
        JSONArray(p.getString("queue", "[]"))
      } catch (_: Throwable) {
        JSONArray()
      }
      p.edit().putString("queue", change(q).toString()).commit()
    }

    /**
     * One round at a time, across service instances too (audit, 07.11.2026):
     * a service destroyed and started again mid-round had the old thread still
     * finishing while the new one began, and both sent — then both took the
     * sent points off, dropping a fix kept in between.
     */
    private val ROUND_RUNNING = AtomicBoolean(false)

    /** "2026-11-07T04:00:00.000Z" (the server's toISOString) → ms; null when it is not one. */
    fun parseIso(s: String?): Long? {
      if (s.isNullOrEmpty()) return null
      for (pattern in arrayOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
        try {
          val f = SimpleDateFormat(pattern, Locale.US)
          f.timeZone = TimeZone.getTimeZone("UTC")
          f.isLenient = false
          val ms = f.parse(s)?.time
          if (ms != null) return ms
        } catch (_: Throwable) {
          // Not this shape: the next one.
        }
      }
      return null
    }

    fun isActive(context: Context): Boolean =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("active", false)
  }

  private var thread: HandlerThread? = null
  private var reported = 0
  private var handler: Handler? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private val prefs get() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /**
   * Each round is timed from its start, not its end (audit, 07.11.2026): a
   * slow fix (up to a minute) and the send's two retries came on top of the
   * five minutes, so the rhythm stretched to 8-10 minutes. A round that ran
   * past its slot is followed by the next one at once, never by two together.
   */
  private val tick = object : Runnable {
    override fun run() {
      val startedAt = android.os.SystemClock.uptimeMillis()
      val interval = prefs.getLong("interval", 300_000L)
      if (!ROUND_RUNNING.compareAndSet(false, true)) {
        // The old instance's round is still finishing: look again shortly.
        if (prefs.getBoolean("active", false)) handler?.postDelayed(this, 5_000L)
        return
      }
      try {
        takeAndSend()
      } catch (e: Throwable) {
        // One bad round never stops the next.
        diag("round failed: ${e.javaClass.simpleName}: ${e.message}", force = true)
      } finally {
        ROUND_RUNNING.set(false)
      }
      if (prefs.getBoolean("active", false)) {
        val next = maxOf(startedAt + interval, android.os.SystemClock.uptimeMillis())
        handler?.postAtTime(this, next)
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      startInForeground()
    } catch (e: Throwable) {
      diag("could not start in the foreground: ${e.javaClass.simpleName}: ${e.message}", force = true)
      stopSelf()
      return START_NOT_STICKY
    }
    if (!prefs.getBoolean("active", false) || prefs.getString("key", null).isNullOrEmpty()) {
      diag("started without a key or not active — stopping", force = true)
      stopSelf()
      return START_NOT_STICKY
    }
    if (thread == null) diag("started: ${describePhone()}", force = true)
    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "bigant:shift-location").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
    // Back in a fresh process with no app (after the swipe above, or Android's
    // own restart): the red GPS screen's watchers are set up here too. Once per
    // process — when the app is open it has done it already.
    GpsGuard.register(this)
    if (thread == null) {
      thread = HandlerThread("bigant-location").also { it.start() }
      handler = Handler(thread!!.looper)
      handler!!.post(tick)
    }
    // Brought back by Android if it ever has to stop it mid-shift.
    return START_STICKY
  }

  /**
   * The driver swiped the app away (owner, 12.11.2026). This service kept the
   * whole process alive, so the app's code stayed as it was and an update
   * waited for "Majburan to'xtatish". The process goes now: Android brings
   * this sticky service straight back in a fresh process (as after any stop
   * mid-shift — the kept points are on disk), and the next time the app is
   * opened it starts afresh and takes the update. Only on shift, and never in
   * the middle of a round (that one finishes first; the next starts anew).
   */
  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
    if (!prefs.getBoolean("active", false)) return
    // Only the app's own screen swiped away (owner, 12.11.2026): the one-tap
    // "turn on location" window runs in a task of its own, and its closing
    // came here too — the app was killed the moment it opened.
    val launcher = packageManager.getLaunchIntentForPackage(packageName)?.component?.className
    val removed = rootIntent?.component?.className
    if (removed != null && launcher != null && removed != launcher) return
    diag("app swiped away: process restarted so the next open is a fresh start", force = true)
    val h = Handler(Looper.getMainLooper())
    val kill = object : Runnable {
      var waited = 0L
      override fun run() {
        // A round in flight (fix or send) finishes first, at most a minute.
        if (ROUND_RUNNING.get() && waited < 60_000L) {
          waited += 1_000L
          h.postDelayed(this, 1_000L)
          return
        }
        // Back in a second by our own alarm (owner, 12.11.2026): Android's own
        // restart of a stopped service waits longer each time — 40 s after a
        // second swipe on the test phone, with no red screen and no position
        // meanwhile. Whichever comes first starts it; a second start is a no-op.
        // Opened again meanwhile (another task of ours is there): leave it be.
        if (appTaskOpen()) return
        scheduleRestart(1_000L)
        android.os.Process.killProcess(android.os.Process.myPid())
      }
    }
    // A moment for the line above to leave and for the app's screen to finish closing.
    h.postDelayed(kill, 1_500L)
  }

  /** A screen of the app is still, or again, open (owner, 12.11.2026). */
  private fun appTaskOpen(): Boolean = try {
    val am = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
    am.appTasks.any { t ->
      try {
        val info = t.taskInfo
        val n = if (Build.VERSION.SDK_INT >= 29) info.numActivities else 1
        n > 0
      } catch (_: Throwable) {
        false
      }
    }
  } catch (_: Throwable) {
    false
  }

  private fun scheduleRestart(afterMs: Long) {
    try {
      val intent = Intent(this, BigantLocationService::class.java)
      val pi = if (Build.VERSION.SDK_INT >= 26) {
        PendingIntent.getForegroundService(this, 4711, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      } else {
        PendingIntent.getService(this, 4711, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      val am = getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
      val at = android.os.SystemClock.elapsedRealtime() + afterMs
      if (Build.VERSION.SDK_INT >= 23) {
        am.setAndAllowWhileIdle(android.app.AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
      } else {
        am.set(android.app.AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
      }
    } catch (e: Throwable) {
      diag("restart alarm refused: ${e.javaClass.simpleName}: ${e.message}", force = true)
    }
  }

  override fun onDestroy() {
    handler?.removeCallbacksAndMessages(null)
    thread?.quitSafely()
    thread = null
    handler = null
    try {
      wakeLock?.release()
    } catch (_: Throwable) {
    }
    wakeLock = null
    super.onDestroy()
  }

  private fun startInForeground() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "BIGANT: ish vaqti", NotificationManager.IMPORTANCE_LOW))
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
      .setContentTitle("BIGANT: ish vaqti")
      .setContentText("Joylashuv yuborilmoqda")
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setOngoing(true)
      .setContentIntent(open)
      .build()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  // --- a fix --------------------------------------------------------------

  private fun takeAndSend() {
    val fix = currentFix()
    if (fix != null) {
      enqueue(fix)
      diag("fix: $lastSource")
    } else {
      diag("no fix this round (GPS on: ${gpsOn()})", force = true)
    }
    // A phone just woken may take a while to bring its network back (owner,
    // 05.11.2026: two sends timed out). Tried again at once, twice, before
    // the points wait for the next round.
    for (wait in longArrayOf(0L, 10_000L, 30_000L)) {
      if (wait > 0) Thread.sleep(wait)
      if (send()) return
    }
  }

  private fun gpsOn(): Boolean =
    (getSystemService(Context.LOCATION_SERVICE) as LocationManager).isProviderEnabled(LocationManager.GPS_PROVIDER)

  private fun describePhone(): String {
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    val fine = checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    val bg = Build.VERSION.SDK_INT < 29 ||
      checkSelfPermission(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    return "${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT}), " +
      "location=$fine background=$bg batteryUnrestricted=${pm.isIgnoringBatteryOptimizations(packageName)} " +
      "gps=${gpsOn()} interval=${prefs.getLong("interval", 0)}"
  }

  /**
   * What the service is doing, told to the server (owner, 05.11.2026): on the
   * test phone it sent nothing and nobody could see why. The first rounds are
   * all told; after that only what went wrong.
   */
  private fun diag(event: String, force: Boolean = false) {
    if (!force && reported >= 12) return
    reported++
    val base = prefs.getString("base", null) ?: return
    Thread {
      var conn: HttpURLConnection? = null
      try {
        conn = (URL("$base/health/client-error").openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"
          connectTimeout = 10_000
          readTimeout = 10_000
          doOutput = true
          setRequestProperty("Content-Type", "application/json")
        }
        val body = JSONObject()
          .put("fatal", false)
          .put("version", "native-location")
          .put("at", iso(System.currentTimeMillis()))
          .put("message", "native-location: $event")
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        conn.responseCode
      } catch (_: Throwable) {
        // Diagnostics never matter more than the position.
      } finally {
        conn?.disconnect()
      }
    }.start()
  }

  /**
   * A fix, trying in turn (owner, 05.11.2026 — indoors the GPS alone gave
   * nothing): the GPS for 25 s; then the network (towers and Wi-Fi, 20-100 m,
   * what Google Maps uses indoors) for 15 s; then Android's fused provider;
   * then the freshest last-known fix of any of them, if under 15 minutes old.
   */
  private fun currentFix(): Location? {
    val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val tries = mutableListOf<Pair<String, Long>>()
    if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) tries.add(LocationManager.GPS_PROVIDER to 25L)
    if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) tries.add(LocationManager.NETWORK_PROVIDER to 15L)
    if (Build.VERSION.SDK_INT >= 31 && lm.allProviders.contains(LocationManager.FUSED_PROVIDER)) {
      tries.add(LocationManager.FUSED_PROVIDER to 15L)
    }
    try {
      for ((provider, wait) in tries) {
        val got = fixFrom(lm, provider, wait)
        if (got != null) {
          lastSource = "$provider ${(System.currentTimeMillis() - got.time) / 1000}s old, ±${got.accuracy.toInt()}m"
          return got
        }
      }
      val last = lm.allProviders.mapNotNull { p ->
        try {
          lm.getLastKnownLocation(p)
        } catch (_: Throwable) {
          null
        }
      }.maxByOrNull { it.time }
      if (last != null && System.currentTimeMillis() - last.time < STALE_FIX_MS) {
        lastSource = "last-known ${last.provider} ${(System.currentTimeMillis() - last.time) / 1000}s old"
        return last
      }
    } catch (_: SecurityException) {
      return null
    }
    return null
  }

  private var lastSource = ""

  private fun fixFrom(lm: LocationManager, provider: String, waitS: Long): Location? {
    var got: Location? = null
    val latch = CountDownLatch(1)
    if (Build.VERSION.SDK_INT >= 30) {
      val cancel = CancellationSignal()
      lm.getCurrentLocation(provider, cancel, { it.run() }) { loc ->
        got = loc
        latch.countDown()
      }
      if (!latch.await(waitS, TimeUnit.SECONDS)) cancel.cancel()
    } else {
      val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
          got = location
          latch.countDown()
        }
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(p: String?, s: Int, e: android.os.Bundle?) {}
        override fun onProviderEnabled(p: String) {}
        override fun onProviderDisabled(p: String) {}
      }
      @Suppress("DEPRECATION")
      lm.requestSingleUpdate(provider, listener, Looper.getMainLooper())
      if (!latch.await(waitS, TimeUnit.SECONDS)) lm.removeUpdates(listener)
    }
    return got
  }

  // --- the queue and the post ----------------------------------------------

  private fun iso(ms: Long): String {
    val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    f.timeZone = TimeZone.getTimeZone("UTC")
    return f.format(Date(ms))
  }

  private fun queue(): JSONArray =
    try {
      JSONArray(prefs.getString("queue", "[]"))
    } catch (_: Throwable) {
      JSONArray()
    }

  private fun enqueue(fix: Location) {
    // The fix's time on the phone's own clock, as the server corrects that clock
    // (owner, 06.11.2026): the age of the fix from the monotonic clock, taken off now.
    val ageMs = (android.os.SystemClock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos) / 1_000_000
    val at = if (ageMs in 0..86_400_000) System.currentTimeMillis() - ageMs else System.currentTimeMillis()
    withQueue(prefs) { q ->
      q.put(JSONObject().put("lat", fix.latitude).put("lng", fix.longitude).put("recorded_at", iso(at)))
      val trimmed = JSONArray()
      val from = maxOf(0, q.length() - MAX_QUEUED)
      for (i in from until q.length()) trimmed.put(q.get(i))
      trimmed
    }
  }

  /** True when there is nothing left to send — sent, or nothing to send, or refused for good. */
  private fun send(): Boolean {
    val q = queue()
    if (q.length() == 0) return true
    val base = prefs.getString("base", null) ?: return true
    val key = prefs.getString("key", null) ?: return true
    var conn: HttpURLConnection? = null
    try {
      conn = (URL("$base/drivers/location/ingest").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 40_000
        readTimeout = 40_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("x-location-key", key)
      }
      conn.outputStream.use { it.write(body(q)) }
      val code = conn.responseCode
      diag("sent ${q.length()} point(s): HTTP $code", force = code != 200)
      when {
        code in 200..299 -> {
          dropSent(prefs, q.length())
          val body = conn.inputStream.bufferedReader().use { it.readText() }
          val answer = try {
            JSONObject(body)
          } catch (_: Throwable) {
            null
          }
          val onShift = answer?.optBoolean("on_shift", true) ?: true
          applyGpsWindow(answer)
          if (!onShift) finish()
          return true
        }
        // The key was replaced or the driver is gone: nothing here will ever be
        // taken. The key goes too, so the app asks for a new one.
        code == 401 -> {
          dropSent(prefs, q.length())
          prefs.edit().remove("key").apply()
          finish()
          return true
        }
        // Refused as invalid: drop them rather than resend them for ever.
        code == 400 -> {
          dropSent(prefs, q.length())
          return true
        }
        // Anything else (no internet, a deploy restarting the server): kept for next time.
      }
    } catch (e: Throwable) {
      // No network: kept, tried again, then sent with the next fix.
      diag("send failed (${q.length()} kept): ${e.javaClass.simpleName}: ${e.message}")
    } finally {
      conn?.disconnect()
    }
    return false
  }

  /**
   * The GPS window from the server's answer (audit, 07.11.2026): with the app
   * closed nobody else updates it, so the red GPS screen kept the window the
   * app last saw — still asking after hours, or not asking for an order taken
   * later. Only when the answer carries the field; null means not required.
   */
  private fun applyGpsWindow(answer: JSONObject?) {
    if (answer == null || !answer.has("gps_required")) return
    // The break's end too, when the answer carries it (owner, 12.11.2026).
    if (answer.has("break_until")) {
      GpsGuard.setBreakEnd(this, parseIso(answer.optString("break_until", "")) ?: 0L)
    }
    val w = answer.optJSONObject("gps_required")
    val from = parseIso(w?.optString("from", ""))
    val until = parseIso(w?.optString("until", ""))
    // GpsGuard writes its prefs and posts the check to its own main-thread handler: safe from here.
    if (from != null && until != null) GpsGuard.setWindow(this, from, until) else GpsGuard.setWindow(this, 0L, 0L)
    // On a break: GPS alone (owner, 12.11.2026).
    if (answer.has("gps_only")) {
      val o = answer.optJSONObject("gps_only")
      val of = parseIso(o?.optString("from", ""))
      val ou = parseIso(o?.optString("until", ""))
      if (of != null && ou != null) GpsGuard.setGpsOnlyWindow(this, of, ou) else GpsGuard.setGpsOnlyWindow(this, 0L, 0L)
    }
  }

  private fun finish() {
    // The shift is over (or the key gone): no red GPS screen after it (audit, 07.11.2026).
    GpsGuard.setWindow(this, 0L, 0L)
    GpsGuard.setGpsOnlyWindow(this, 0L, 0L)
    prefs.edit().putBoolean("active", false).apply()
    Handler(Looper.getMainLooper()).post { stopSelf() }
  }
}
