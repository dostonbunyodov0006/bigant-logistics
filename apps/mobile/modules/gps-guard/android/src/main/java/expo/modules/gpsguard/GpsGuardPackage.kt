package expo.modules.gpsguard

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** Listens from the moment the app's process starts — the location service starts it too, with no screen. */
class GpsGuardPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context?): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        GpsGuard.register(application)
      }
    })
}
