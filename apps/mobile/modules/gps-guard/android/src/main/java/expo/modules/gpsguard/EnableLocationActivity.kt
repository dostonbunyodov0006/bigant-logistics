package expo.modules.gpsguard

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority

/**
 * "GPS NI YOQISH" on the red screen, in one tap (owner, 12.11.2026): Google's
 * own "Turn on location? — OK" sheet, as Google Maps shows, instead of the
 * settings page where he had to find the switch. Invisible itself; it only
 * hosts that sheet and closes. A phone without Google services, or one that
 * cannot show the sheet, gets the settings page as before.
 */
class EnableLocationActivity : Activity() {
  private var done = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L).build()
      val settings = LocationSettingsRequest.Builder().addLocationRequest(request).setAlwaysShow(true).build()
      LocationServices.getSettingsClient(this).checkLocationSettings(settings)
        .addOnSuccessListener { close() }
        .addOnFailureListener { e ->
          if (e is ResolvableApiException) {
            try {
              e.startResolutionForResult(this, REQUEST)
              return@addOnFailureListener
            } catch (_: Throwable) {
              // Could not show it: the settings page below.
            }
          }
          openSettingsPage()
          close()
        }
    } catch (_: Throwable) {
      openSettingsPage()
      close()
    }
  }

  @Deprecated("Deprecated in Java")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION")
    super.onActivityResult(requestCode, resultCode, data)
    close()
  }

  private fun openSettingsPage() {
    try {
      startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Throwable) {
      // Nothing to open: the quick settings tile still works.
    }
  }

  private fun close() {
    if (done) return
    done = true
    // The red screen looks again at once: gone if GPS is on now, back if not.
    GpsGuard.recheck(this)
    finish()
    @Suppress("DEPRECATION")
    overridePendingTransition(0, 0)
  }

  companion object {
    private const val REQUEST = 4712
  }
}
