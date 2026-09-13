import qrcode from 'qrcode-generator'

interface Props {
  value: string
  size?: number
  label?: string
}

// Renders as plain SVG <rect>s built from the QR matrix (no canvas, no
// dangerouslySetInnerHTML) so it behaves identically in `vite dev` and the
// packaged Tizen widget. qrcode-generator is a long-established,
// dependency-free, pure-JS implementation — safe for Tizen's older WebKit
// engine, unlike canvas- or Web Component-based QR libraries.
export function QrCode({ value, size = 200, label = 'QR code to connect this TV' }: Props) {
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()

  const count = qr.getModuleCount()
  // Four light modules on every side are part of a QR code's required
  // quiet zone. Keeping them inside the requested pixel size makes both the
  // setup and purchase codes more reliable from sofa distance.
  const quiet = 4
  const viewSize = count + quiet * 2

  const rects: React.ReactNode[] = []
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        rects.push(<rect key={`${row}-${col}`} x={col + quiet} y={row + quiet} width={1} height={1} />)
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={viewSize} height={viewSize} fill="#fff" />
      <g fill="#000">{rects}</g>
    </svg>
  )
}
