package expo.modules.gpsguard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * The phone came back on (owner, 06.11.2026): a driver whose battery ran out
 * mid-shift turns the phone on and drives off without opening the app, and
 * his road was not kept until he did. If the shift's location service was on
 * when the phone went off, it is started again here, with the key it had; the
 * server's first answer stops it if the shift has been closed meanwhile.
 * Also after the app itself is updated by a new APK.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED &&
      action != "android.intent.action.QUICKBOOT_POWERON" &&
      action != Intent.ACTION_MY_PACKAGE_REPLACED
    ) return
    if (!BigantLocationService.isActive(context)) return
    try {
      BigantLocationService.resume(context)
    } catch (e: Throwable) {
      // Android refused a background start (no "Always" location): the app starts it when opened.
      Log.w("BigantBoot", "could not restart the shift location: ${e.message}")
    }
  }
}
