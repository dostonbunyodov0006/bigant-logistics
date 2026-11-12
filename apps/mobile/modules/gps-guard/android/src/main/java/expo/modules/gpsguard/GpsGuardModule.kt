package expo.modules.gpsguard

import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GpsGuardModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext).applicationContext

  override fun definition() = ModuleDefinition {
    Name("GpsGuard")

    OnCreate { GpsGuard.register(context) }

    Function("setShiftActive") { on: Boolean -> GpsGuard.setShiftActive(context, on) }

    Function("setWindow") { fromMs: Double, untilMs: Double -> GpsGuard.setWindow(context, fromMs.toLong(), untilMs.toLong()) }

    Function("canDrawOverlays") { GpsGuard.canDrawOverlays(context) }

    // The break's end, for the red screen's "extend the break" (owner, 12.11.2026).
    Function("setBreakEnd") { ms: Double -> GpsGuard.setBreakEnd(context, ms.toLong()) }

    Function("consumeAction") { GpsGuard.consumeAction(context) }

    // On a break: GPS alone (owner, 12.11.2026).
    Function("setGpsOnlyWindow") { fromMs: Double, untilMs: Double -> GpsGuard.setGpsOnlyWindow(context, fromMs.toLong(), untilMs.toLong()) }

    // Battery "Без ограничений" (owner, 04.11.2026): asked when the shift starts,
    // or Android holds back the position and the network with the app closed.
    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("requestIgnoreBatteryOptimizations") {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
      } catch (_: Exception) {
        val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(list)
      }
    }

    // The shift's position, taken and sent by the phone itself (owner, 05.11.2026).
    // "" when started; otherwise what stopped it, for the app to report.
    Function("startTracking") { baseUrl: String, key: String, intervalMs: Double ->
      try {
        BigantLocationService.start(context, baseUrl, key, intervalMs.toLong())
        ""
      } catch (e: Throwable) {
        "${e.javaClass.simpleName}: ${e.message}"
      }
    }

    // Off the main thread: a network call.
    AsyncFunction("flushTracking") { BigantLocationService.flush(context) }

    Function("resumeTrackingError") {
      try {
        if (BigantLocationService.resume(context)) "" else "no-key"
      } catch (e: Throwable) {
        "${e.javaClass.simpleName}: ${e.message}"
      }
    }

    Function("stopTracking") { BigantLocationService.stop(context) }

    Function("resumeTracking") { BigantLocationService.resume(context) }

    Function("forgetTracking") { BigantLocationService.forget(context) }

    // Xiaomi, Oppo, Vivo, Huawei: their own autostart switch (owner, 05.11.2026).
    Function("autostartNeeded") { Autostart.needed() && !Autostart.confirmed(context) }

    Function("openAutostart") { Autostart.open(context) }

    Function("confirmAutostart") { Autostart.confirm(context) }

    Function("isTracking") { BigantLocationService.isActive(context) }

    Function("openOverlaySettings") {
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }
}
