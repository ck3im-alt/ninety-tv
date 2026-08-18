import './Breadcrumb.css'

export function Breadcrumb({ items }: { items: string[] }) {
  return (
    <div className="breadcrumb">
      {items.map((item, index) => (
        <span key={item} className={index === 0 ? 'crumb-first' : 'crumb'}>
          {item}
          {index < items.length - 1 && <span className="crumb-separator">/</span>}
        </span>
      ))}
    </div>
  )
}
