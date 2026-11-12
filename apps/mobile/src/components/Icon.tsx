import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg';
import { colors } from './theme';

/**
 * The app's icons, drawn as stroke paths on a 24×24 grid.
 *
 * Until now these were text characters and emoji — a bell that renders as a
 * different picture on every handset, a tick that sits half a pixel off its
 * dot. Every icon here is one shape at one weight, so a row of them lines up
 * and a driver reads the same screen on any phone.
 *
 * Add an icon by adding a case; nothing else in the app touches react-native-svg.
 */
export type IconName =
  | 'bell'
  | 'box'
  | 'calendar'
  | 'camera'
  | 'check'
  | 'chevron-left'
  | 'clock'
  | 'eye'
  | 'eye-off'
  | 'chevron-right'
  | 'fuel'
  | 'image'
  | 'info'
  | 'list'
  | 'lock'
  | 'navigation'
  | 'phone'
  | 'pin'
  | 'plus'
  | 'return'
  | 'road'
  | 'search'
  | 'settings'
  | 'trash'
  | 'warning'
  | 'wrench'
  | 'x';

export function Icon({
  name,
  size = 18,
  color = colors.graphite,
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const stroke = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {shape(name, stroke)}
    </Svg>
  );
}

type Stroke = {
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  fill: string;
};

function shape(name: IconName, p: Stroke) {
  switch (name) {
    case 'bell':
      return (
        <>
          <Path {...p} d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <Path {...p} d="M13.7 21a2 2 0 0 1-3.4 0" />
        </>
      );
    case 'box':
      return (
        <>
          <Path {...p} d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <Path {...p} d="m3.3 7 8.7 5 8.7-5" />
          <Path {...p} d="M12 22V12" />
        </>
      );
    case 'camera':
      return (
        <>
          <Path {...p} d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z" />
          <Circle {...p} cx={12} cy={13} r={3.5} />
        </>
      );
    case 'eye':
      return (
        <>
          <Path {...p} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <Circle {...p} cx={12} cy={12} r={3} />
        </>
      );
    case 'eye-off':
      return (
        <>
          <Path {...p} d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6" />
          <Path {...p} d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6" />
          <Path {...p} d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <Path {...p} d="m2 2 20 20" />
        </>
      );
    case 'check':
      return <Path {...p} d="m20 6-11 11-5-5" />;
    case 'chevron-left':
      return <Path {...p} d="m15 18-6-6 6-6" />;
    case 'chevron-right':
      return <Path {...p} d="m9 18 6-6-6-6" />;
    case 'fuel':
      return (
        <>
          <Path {...p} d="M4 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15" />
          <Path {...p} d="M4 11h10" />
          <Path {...p} d="M14 9h2l2 2v6a1.5 1.5 0 0 0 3 0v-7l-2-2" />
          <Path {...p} d="M3 21h12" />
        </>
      );
    case 'image':
      return (
        <>
          <Rect {...p} x={3} y={4} width={18} height={16} rx={2} />
          <Circle {...p} cx={8.5} cy={9.5} r={1.8} />
          <Path {...p} d="m3 17 5-5 4 4 3-3 6 6" />
        </>
      );
    case 'info':
      return (
        <>
          <Circle {...p} cx={12} cy={12} r={9} />
          <Path {...p} d="M12 16v-4" />
          <Path {...p} d="M12 8h.01" />
        </>
      );
    case 'list':
      return (
        <>
          <Path {...p} d="M8 6h13M8 12h13M8 18h13" />
          <Path {...p} d="M3 6h.01M3 12h.01M3 18h.01" />
        </>
      );
    case 'lock':
      return (
        <>
          <Rect {...p} x={4} y={10} width={16} height={11} rx={2} />
          <Path {...p} d="M8 10V7a4 4 0 0 1 8 0v3" />
        </>
      );
    case 'navigation':
      return <Polygon {...p} points="3 11 22 2 13 21 11 13 3 11" />;
    case 'phone':
      return (
        <Path
          {...p}
          d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"
        />
      );
    case 'pin':
      return (
        <>
          <Path {...p} d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" />
          <Circle {...p} cx={12} cy={10} r={3} />
        </>
      );
    case 'return':
      return (
        <>
          <Path {...p} d="M9 14 4 9l5-5" />
          <Path {...p} d="M4 9h11a5 5 0 0 1 5 5v6" />
        </>
      );
    case 'road':
      return (
        <>
          <Path {...p} d="M4 19 8 5h8l4 14" />
          <Path {...p} d="M12 5v3M12 11v3M12 17v2" />
        </>
      );
    case 'search':
      return (
        <>
          <Circle {...p} cx={11} cy={11} r={8} />
          <Path {...p} d="m21 21-4.3-4.3" />
        </>
      );
    case 'warning':
      return (
        <>
          <Path {...p} d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
          <Path {...p} d="M12 9v4" />
          <Path {...p} d="M12 17h.01" />
        </>
      );
    case 'settings':
      return (
        <>
          <Circle {...p} cx={12} cy={12} r={3} />
          <Path
            {...p}
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </>
      );
    case 'wrench':
      return (
        <Path
          {...p}
          d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
        />
      );
    case 'calendar':
      return (
        <>
          <Rect {...p} x={3} y={4} width={18} height={18} rx={2} />
          <Path {...p} d="M16 2v4M8 2v4M3 10h18" />
        </>
      );
    case 'clock':
      return (
        <>
          <Circle {...p} cx={12} cy={12} r={9} />
          <Path {...p} d="M12 7v5l3 2" />
        </>
      );
    case 'plus':
      return <Path {...p} d="M12 5v14M5 12h14" />;
    case 'trash':
      return <Path {...p} d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />;
    case 'x':
      return <Path {...p} d="M18 6 6 18M6 6l12 12" />;
  }
}
