package expo.modules.gpsguard

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Xiaomi, Oppo, Vivo, Huawei and their kin kill an app's background service
 * unless it is allowed to "autostart" - a setting of their own, outside
 * Android's, that no app can switch on or even read (owner, 05.11.2026). What
 * an app can do is open that page; the driver turns BIGANT on and says so.
 */
object Autostart {
  private const val PREFS = "bigant.gpsguard"
  private const val KEY = "autostart_confirmed"

  private val brands = setOf("xiaomi", "redmi", "poco", "oppo", "realme", "oneplus", "vivo", "iqoo", "huawei", "honor")

  private val pages = listOf(
    "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
    "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
    "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
    "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
    "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
    "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
    "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
    "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity",
  )

  /** A phone whose maker has its own autostart switch. */
  fun needed(): Boolean = Build.MANUFACTURER.lowercase() in brands || Build.BRAND.lowercase() in brands

  fun confirmed(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

  fun confirm(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, true).apply()
  }

  /** The maker's autostart page; the app's own settings page when none of them is there. */
  fun open(context: Context) {
    for ((pkg, cls) in pages) {
      val intent = Intent().setComponent(ComponentName(pkg, cls)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (intent.resolveActivity(context.packageManager) != null) {
        try {
          context.startActivity(intent)
          return
        } catch (_: Exception) {
          // Not allowed on this build: the next one.
        }
      }
    }
    val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(details)
  }
}
