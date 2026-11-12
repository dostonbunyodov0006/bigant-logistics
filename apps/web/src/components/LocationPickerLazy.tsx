import { Suspense, lazy, type ComponentProps } from 'react';

const Picker = lazy(() => import('./LocationPicker').then((m) => ({ default: m.LocationPicker })));

/**
 * Leaflet is ~150 kB; only the four create/edit forms need it. Same pattern as
 * DriversMap. The fallback reserves the map's height so opening a form does
 * not jump when the chunk arrives.
 */
export function LocationPickerLazy(props: ComponentProps<typeof Picker>) {
  return (
    <Suspense fallback={<div className="mt-2 h-64 w-full animate-pulse rounded-lg bg-paper" />}>
      <Picker {...props} />
    </Suspense>
  );
}
