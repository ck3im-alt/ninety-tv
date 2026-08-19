import qrcode from 'qrcode-generator'

interface Props {
  value: string
  size?: number
}

// Renders as plain SVG <rect>s built from the QR matrix (no canvas, no
// dangerouslySetInnerHTML) so it behaves identically in `vite dev` and the
// packaged Tizen widget. qrcode-generator is a long-established,
// dependency-free, pure-JS implementation — safe for Tizen's older WebKit
// engine, unlike canvas- or Web Component-based QR libraries.
export function QrCode({ value, size = 200 }: Props) {
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()

  const count = qr.getModuleCount()
  const cell = size / count

  const rects: React.ReactNode[] = []
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        rects.push(<rect key={`${row}-${col}`} x={col * cell} y={row * cell} width={cell} height={cell} />)
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="QR code to connect your playlist"
    >
      <rect width={size} height={size} fill="#fff" />
      <g fill="#000">{rects}</g>
    </svg>
  )
}
