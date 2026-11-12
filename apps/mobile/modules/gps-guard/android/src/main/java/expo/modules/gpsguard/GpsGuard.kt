package expo.modules.gpsguard

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.location.LocationManagerCompat

/**
 * GPS or the internet turned off on shift, with the app closed (owner,
 * 04.11.2026): a red screen is drawn over whatever the phone shows — the home
 * screen, another app — with one button to turn it back on. It goes away the
 * moment it is back on, and comes back every minute while it is not.
 *
 * Only within the window the server sends (working hours, or work in hand).
 * Internet switched off by hand — airplane mode or mobile data off — is the
 * same full red screen as GPS, at once. No signal with everything switched on
 * (a road through the steppe) is only a notification (owner, 06.11.2026): the
 * full screen there hid the navigator and the dialer from a driver who had
 * done nothing wrong. The moment a connection is back both go. Looked at
 * every three seconds while anything is off.
 *
 * Drawn as an overlay window ("display over other apps"): since Android 15 an
 * app may no longer bring itself to the front from the background, but it may
 * still draw over the screen with that permission.
 */
object GpsGuard {
  private const val PREFS = "bigant.gpsguard"
  private const val KEY_FROM = "required_from"
  private const val KEY_UNTIL = "required_until"
  /** On a break: GPS alone is watched from..until (owner, 12.11.2026). */
  private const val KEY_ONLY_FROM = "gps_only_from"
  private const val KEY_ONLY_UNTIL = "gps_only_until"
  /** When the break ends; the red screen offers to extend it for a while after (owner, 12.11.2026). */
  private const val KEY_BREAK_END = "break_end"
  /** What was pressed on the red screen to open the app, read once by the app. */
  private const val KEY_ACTION = "pending_action"
  /** The break's end passed less than this long ago: the button is shown. */
  private const val BREAK_BUTTON_FOR_MS = 3 * 3_600_000L
  /** The app is given this long, red screen aside, to extend the break. */
  private const val EXTEND_GRACE_MS = 3 * 60_000L
  /** While something is off it is looked at this often, so the screen comes and goes at once. */
  private const val REPEAT_MS = 3_000L
  /** While the red screen stays, the phone shakes again this often (owner, 07.11.2026: 30 s). */
  private const val BUZZ_EVERY_MS = 30_000L
  /** A connection gone for less than this (a hand-over between towers) is not shown. */
  private const val NET_GRACE_MS = 4_000L
  /** After the button the settings need the screen for a while. */
  private const val SETTINGS_GRACE_MS = 20_000L
  private const val RED = 0xFFB91C1C.toInt()

  /**
   * POWER_LOW: battery saver on with the battery at 20% or less — Android turns
   * it on by itself there (owner, 07.11.2026). He is told to charge the phone
   * and switch the saver off, not that he switched it on.
   */
  private enum class Off { GPS, NET, POWER, POWER_LOW }

  /** At or under this, battery saver is taken as Android's own doing (owner, 07.11.2026). */
  private const val LOW_BATTERY_PCT = 20

  @Volatile private var registered = false
  private val handler = Handler(Looper.getMainLooper())
  private var repeat: Runnable? = null
  private var overlay: View? = null
  private var shown: Off? = null
  private var startTimer: Runnable? = null
  private var graceUntil = 0L
  private var netLostAt = 0L
  private var lastBuzz = 0L

  /** Four long pulses: felt in a pocket, so the driver looks at the phone (owner, 07.11.2026). */
  private fun buzz(app: Context) {
    lastBuzz = System.currentTimeMillis()
    try {
      val pattern = longArrayOf(0, 700, 300, 700, 300, 700, 300, 700)
      val v: android.os.Vibrator? = if (Build.VERSION.SDK_INT >= 31) {
        (app.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? android.os.VibratorManager)?.defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        app.getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator
      }
      if (v == null || !v.hasVibrator()) return
      if (Build.VERSION.SDK_INT >= 26) {
        v.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1))
      } else {
        @Suppress("DEPRECATION")
        v.vibrate(pattern, -1)
      }
    } catch (_: Throwable) {
      // No vibrator, or refused: the red screen is still there.
    }
  }

  /**
   * GPS is required from `fromMs` to `untilMs` (owner, 04.11.2026): the working
   * hours, or while an order is in hand — worked out by the server. 0, 0: not
   * required. Outside the window nothing is shown.
   */
  fun setWindow(context: Context, fromMs: Long, untilMs: Long) {
    val app = context.applicationContext
    prefs(app).edit().putLong(KEY_FROM, fromMs).putLong(KEY_UNTIL, untilMs).apply()
    handler.post { check(app) }
  }

  /** Look again now, no grace: after the one-tap "turn on location" sheet closed (owner, 12.11.2026). */
  fun recheck(context: Context) {
    val app = context.applicationContext
    graceUntil = 0L
    handler.post { check(app) }
  }

  /**
   * On a break (owner, 12.11.2026): GPS alone must stay on from `fromMs` to
   * `untilMs`; internet and battery saver are not asked. 0, 0: none.
   */
  fun setGpsOnlyWindow(context: Context, fromMs: Long, untilMs: Long) {
    val app = context.applicationContext
    prefs(app).edit().putLong(KEY_ONLY_FROM, fromMs).putLong(KEY_ONLY_UNTIL, untilMs).apply()
    handler.post { check(app) }
  }

  private fun gpsOnly(context: Context): Boolean {
    val now = System.currentTimeMillis()
    return now >= prefs(context).getLong(KEY_ONLY_FROM, 0L) && now < prefs(context).getLong(KEY_ONLY_UNTIL, 0L)
  }

  /** What is off that must not be: everything in the window, GPS alone on a break. */
  private fun offNow(app: Context): Off? = when {
    required(app) -> whatIsOff(app)
    gpsOnly(app) -> if (!gpsOn(app)) Off.GPS else null
    else -> null
  }

  /** The break's end, or 0 (owner, 12.11.2026). */
  fun setBreakEnd(context: Context, ms: Long) {
    prefs(context.applicationContext).edit().putLong(KEY_BREAK_END, ms).apply()
  }

  /** What was pressed on the red screen, once: "extend_break", or "". */
  fun consumeAction(context: Context): String {
    val p = prefs(context.applicationContext)
    val a = p.getString(KEY_ACTION, "") ?: ""
    if (a.isNotEmpty()) p.edit().remove(KEY_ACTION).apply()
    return a
  }

  private fun breakJustEnded(app: Context): Boolean {
    val end = prefs(app).getLong(KEY_BREAK_END, 0L)
    val now = System.currentTimeMillis()
    return end > 0L && now >= end && now - end < BREAK_BUTTON_FOR_MS
  }

  /** "TANAFFUSNI CHO'ZISH": the app opens on the sheet, the red screen steps aside a few minutes. */
  private fun openExtend(app: Context) {
    prefs(app).edit().putString(KEY_ACTION, "extend_break").apply()
    graceUntil = System.currentTimeMillis() + EXTEND_GRACE_MS
    handler.postDelayed({ hide(app) }, 400L)
    try {
      app.packageManager.getLaunchIntentForPackage(app.packageName)?.let {
        app.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    } catch (_: Exception) {
      // Could not open: the red screen comes back after the grace.
    }
    handler.postDelayed({ check(app) }, EXTEND_GRACE_MS)
  }

  /** Older JavaScript: on shift means required all day. */
  fun setShiftActive(context: Context, on: Boolean) =
    setWindow(context, 0L, if (on) System.currentTimeMillis() + 24 * 3_600_000L else 0L)

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun required(context: Context): Boolean {
    val now = System.currentTimeMillis()
    return now >= prefs(context).getLong(KEY_FROM, 0L) && now < prefs(context).getLong(KEY_UNTIL, 0L)
  }

  fun canDrawOverlays(context: Context) = Settings.canDrawOverlays(context)

  fun gpsOn(context: Context): Boolean {
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return true
    return LocationManagerCompat.isLocationEnabled(lm)
  }

  /** No internet because he switched it off — airplane mode or mobile data off: the red screen, at once. */
  fun internetOff(context: Context): Boolean {
    if (hasInternet(context)) {
      netLostAt = 0L
      return false
    }
    if (netLostAt == 0L) netLostAt = System.currentTimeMillis()
    return switchedOffByHand(context)
  }

  /** No internet with everything switched on (no signal), for a few seconds running: only a notification. */
  private fun noSignal(context: Context): Boolean =
    !hasInternet(context) && !switchedOffByHand(context) &&
      netLostAt != 0L && System.currentTimeMillis() - netLostAt >= NET_GRACE_MS

  private fun switchedOffByHand(context: Context): Boolean {
    val cr = context.contentResolver
    val airplane = Settings.Global.getInt(cr, Settings.Global.AIRPLANE_MODE_ON, 0) == 1
    val dataOff = Settings.Global.getInt(cr, "mobile_data", 1) == 0
    return airplane || dataOff
  }

  /** Battery saver ("Экономия энергии") on: Android holds back the position and the network. */
  /** The battery level in percent; -1 when the phone does not say. */
  private fun batteryPct(context: Context): Int {
    val bm = context.getSystemService(Context.BATTERY_SERVICE) as? android.os.BatteryManager ?: return -1
    return bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
  }

  fun powerSaveOn(context: Context): Boolean {
    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
    return pm.isPowerSaveMode
  }

  private fun hasInternet(context: Context): Boolean {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
    val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
  }

  private fun whatIsOff(app: Context): Off? = when {
    !gpsOn(app) -> Off.GPS
    internetOff(app) -> Off.NET
    powerSaveOn(app) -> if (batteryPct(app) in 0..LOW_BATTERY_PCT) Off.POWER_LOW else Off.POWER
    else -> null
  }

  fun register(context: Context) {
    if (registered) return
    registered = true
    val app = context.applicationContext
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(c: Context, intent: Intent) {
        handler.post { check(app) }
      }
    }
    val filter = IntentFilter().apply {
      addAction(LocationManager.PROVIDERS_CHANGED_ACTION)
      addAction(LocationManager.MODE_CHANGED_ACTION)
      addAction(Intent.ACTION_AIRPLANE_MODE_CHANGED)
      addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
    }
    if (Build.VERSION.SDK_INT >= 33) {
      app.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      app.registerReceiver(receiver, filter)
    }
    // Mobile data switched on or off.
    try {
      app.contentResolver.registerContentObserver(
        Settings.Global.getUriFor("mobile_data"),
        false,
        object : ContentObserver(handler) {
          override fun onChange(selfChange: Boolean) {
            handler.postDelayed({ check(app) }, 1_500L)
          }
        },
      )
    } catch (_: Exception) {
      // Not on this phone: the network callback and the minute check still look.
    }
    try {
      val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
          handler.post { check(app) }
        }
        override fun onLost(network: Network) {
          handler.post { check(app) }
        }
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
          handler.post { check(app) }
        }
      })
    } catch (_: Exception) {
      // Fine: the broadcasts still come.
    }
    handler.post { check(app) }
  }

  /** On the main thread: something off within the window shows the red screen and keeps it coming back. */
  private fun check(app: Context) {
    armStart(app)
    val off = offNow(app)
    signalNotice(app, off == null && required(app) && noSignal(app))
    if (off == null) {
      hide(app)
      // Lost a moment ago: look again once the grace is over.
      if (required(app) && netLostAt != 0L) {
        if (repeat == null) {
          val r = Runnable {
            repeat = null
            check(app)
          }
          repeat = r
          handler.postDelayed(r, NET_GRACE_MS)
        }
      } else {
        stopRepeat()
      }
      return
    }
    if (System.currentTimeMillis() >= graceUntil) show(app, off)
    if (repeat == null) {
      val r = object : Runnable {
        override fun run() {
          val now = offNow(app)
          if (now == null) {
            stopRepeat()
            hide(app)
            return
          }
          if (System.currentTimeMillis() >= graceUntil) show(app, now)
          handler.postDelayed(this, REPEAT_MS)
        }
      }
      repeat = r
      handler.postDelayed(r, REPEAT_MS)
    }
  }

  /** Something already off before the window opens: look again the moment it does. */
  private fun armStart(app: Context) {
    startTimer?.let { handler.removeCallbacks(it) }
    startTimer = null
    val now = System.currentTimeMillis()
    val p = prefs(app)
    val starts = listOf(
      p.getLong(KEY_FROM, 0L) to p.getLong(KEY_UNTIL, 0L),
      p.getLong(KEY_ONLY_FROM, 0L) to p.getLong(KEY_ONLY_UNTIL, 0L),
    ).filter { (f, u) -> f > now && u > f }.map { it.first }
    val from = starts.minOrNull() ?: return
    val r = Runnable { check(app) }
    startTimer = r
    handler.postDelayed(r, from - now + 1_000L)
  }

  private fun stopRepeat() {
    repeat?.let { handler.removeCallbacks(it) }
    repeat = null
  }

  private const val SIGNAL_CHANNEL = "bigant_signal"
  private const val SIGNAL_ID = 7301
  private var signalShown = false

  /** "Aloqa yo'q" in the notification shade while there is no signal; gone when it is back. */
  private fun signalNotice(app: Context, on: Boolean) {
    if (on == signalShown) return
    val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (!on) {
      nm.cancel(SIGNAL_ID)
      signalShown = false
      return
    }
    try {
      if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(SIGNAL_CHANNEL) == null) {
        nm.createNotificationChannel(NotificationChannel(SIGNAL_CHANNEL, "Aloqa", NotificationManager.IMPORTANCE_DEFAULT))
      }
      val open = app.packageManager.getLaunchIntentForPackage(app.packageName)?.let {
        PendingIntent.getActivity(app, SIGNAL_ID, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      val n = NotificationCompat.Builder(app, SIGNAL_CHANNEL)
        .setSmallIcon(android.R.drawable.stat_sys_warning)
        .setContentTitle("Aloqa yo'q")
        .setContentText("Signal yo'q joydasiz. Joylashuv telefonda saqlanadi va aloqa tiklanganda yuboriladi.")
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .apply { if (open != null) setContentIntent(open) }
        .build()
      nm.notify(SIGNAL_ID, n)
      signalShown = true
    } catch (_: Exception) {
      // No permission to notify: nothing more to do — the app shows it when opened.
    }
  }

  private fun hide(app: Context) {
    val v = overlay ?: return
    overlay = null
    shown = null
    try {
      (app.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(v)
    } catch (_: Exception) {
      // Already gone.
    }
  }

  private fun show(app: Context, off: Off) {
    if (!Settings.canDrawOverlays(app)) return
    // Shaken only for what he switched off by hand (owner, 07.11.2026); a phone
    // low on battery is not shaken flatter still.
    val shake = off != Off.POWER_LOW
    if (overlay != null && shown == off) {
      if (shake && System.currentTimeMillis() - lastBuzz >= BUZZ_EVERY_MS) buzz(app)
      return
    }
    hide(app)
    val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val view = build(app, off)
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.OPAQUE,
    )
    try {
      wm.addView(view, params)
      overlay = view
      shown = off
      if (shake) buzz(app)
    } catch (_: Exception) {
      // Refused this time; the next minute tries again.
    }
  }

  private fun dp(app: Context, v: Float) =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, app.resources.displayMetrics).toInt()

  private fun build(app: Context, off: Off): View {
    val gps = off == Off.GPS
    val power = off == Off.POWER
    val low = off == Off.POWER_LOW
    val root = LinearLayout(app).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(RED)
      setPadding(dp(app, 28f), dp(app, 28f), dp(app, 28f), dp(app, 28f))
    }
    val mark = TextView(app).apply {
      text = "!"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 60f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setStroke(dp(app, 5f), Color.WHITE)
      }
    }
    root.addView(mark, LinearLayout.LayoutParams(dp(app, 100f), dp(app, 100f)))
    val title = TextView(app).apply {
      text = when {
        gps -> "GPS O'CHIQ!"
        low -> "QUVVAT KAM!"
        power -> "QUVVAT TEJASH YOQIQ!"
        else -> "INTERNET O'CHIQ!"
      }
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
    }
    root.addView(title, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(app, 22f) })
    val body = TextView(app).apply {
      text = when {
        gps -> "Ish vaqtida GPS ni o'chirib bo'lmaydi.\nGPS yoqilmasa, bonusingiz hisoblanmaydi."
        low -> "Telefoningizni zaryadlang va quvvat tejash rejimini o'chiring.\nRejim yoniq bo'lsa, bonusingiz hisoblanmaydi."
        power -> "Ish vaqtida quvvat tejashni yoqib bo'lmaydi.\nBonusingiz hisoblanmaydi."
        else -> "Ish vaqtida internetni o'chirib bo'lmaydi.\nInternet yoqilmasa, bonusingiz hisoblanmaydi."
      }
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
      gravity = Gravity.CENTER
      setLineSpacing(0f, 1.15f)
    }
    root.addView(body, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(app, 14f) })
    val button = TextView(app).apply {
      text = when {
        gps -> "GPS NI YOQISH"
        power || low -> "O'CHIRISH"
        else -> "INTERNETNI YOQISH"
      }
      setTextColor(RED)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 21f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setPadding(0, dp(app, 18f), 0, dp(app, 18f))
      background = GradientDrawable().apply {
        setColor(Color.WHITE)
        cornerRadius = dp(app, 16f).toFloat()
      }
      setOnClickListener { openSettings(app, off) }
    }
    root.addView(button, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(app, 30f) })
    // Just back from a break, not ready yet: a longer break, with a reason (owner, 12.11.2026).
    if (breakJustEnded(app)) {
      val extend = TextView(app).apply {
        text = "TANAFFUSNI CHO'ZISH"
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setPadding(0, dp(app, 16f), 0, dp(app, 16f))
        background = GradientDrawable().apply {
          setColor(Color.TRANSPARENT)
          setStroke(dp(app, 2f), Color.WHITE)
          cornerRadius = dp(app, 16f).toFloat()
        }
        setOnClickListener { openExtend(app) }
      }
      root.addView(extend, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(app, 14f) })
    }
    return root
  }

  /** The red screen steps aside for Android's own page; back in 20 s if still off. */
  private fun openSettings(app: Context, off: Off) {
    // Started while the red screen is still up — a visible overlay is what lets
    // an app open a page from the background — and only then stepped aside.
    handler.postDelayed({ hide(app) }, 400L)
    graceUntil = System.currentTimeMillis() + SETTINGS_GRACE_MS
    // GPS: Google's one-tap "turn on location — OK" sheet (owner, 12.11.2026);
    // it falls back to the settings page by itself.
    if (off == Off.GPS) {
      try {
        app.startActivity(Intent(app, EnableLocationActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        handler.postDelayed({ check(app) }, SETTINGS_GRACE_MS)
        return
      } catch (_: Exception) {
        // Not this time: the settings page below.
      }
    }
    val action = when {
      off == Off.GPS -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
      off == Off.POWER || off == Off.POWER_LOW -> Settings.ACTION_BATTERY_SAVER_SETTINGS
      // The internet panel: mobile data, Wi-Fi and airplane mode in one sheet.
      Build.VERSION.SDK_INT >= 29 -> Settings.Panel.ACTION_INTERNET_CONNECTIVITY
      else -> Settings.ACTION_WIRELESS_SETTINGS
    }
    try {
      app.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) {
      try {
        app.startActivity(Intent(Settings.ACTION_WIRELESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (_: Exception) {
        // Nothing to open: the quick settings tiles still work.
      }
    }
    handler.postDelayed({ check(app) }, SETTINGS_GRACE_MS)
  }
}
