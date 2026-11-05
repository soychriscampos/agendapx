'use client'

import { useState, type CSSProperties } from 'react'

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })

export default function AppointmentCalculator() {
  const [calls, setCalls] = useState(20)
  const [price, setPrice] = useState(1000)
  const [rate, setRate] = useState(40)
  const total = calls * price * rate / 100

  function fill(value: number, min: number, max: number): CSSProperties {
    return { '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties
  }

  return (
    <div className="calc-grid">
      <div className="calc-fields">
        <div>
          <label htmlFor="calls">Llamadas sin atender al mes <output id="calls-out">{calls}</output></label>
          <input id="calls" type="range" min="0" max="100" step="1" value={calls} style={fill(calls, 0, 100)} onChange={(event) => setCalls(Number(event.target.value))}/>
        </div>
        <div>
          <label htmlFor="price">Precio de tu consulta <output id="price-out">{money.format(price)}</output></label>
          <input id="price" type="range" min="300" max="3000" step="50" value={price} style={fill(price, 300, 3000)} onChange={(event) => setPrice(Number(event.target.value))}/>
        </div>
        <div>
          <label htmlFor="rate">¿Cuántas podrían convertirse en citas? <output id="rate-out">{rate}%</output></label>
          <input id="rate" type="range" min="0" max="100" step="5" value={rate} style={fill(rate, 0, 100)} onChange={(event) => setRate(Number(event.target.value))}/>
        </div>
      </div>
      <div className="calc-result" aria-live="polite">
        <p>Valor mensual potencial</p>
        <strong id="total">{money.format(total)}</strong>
        <p className="disclaimer">Estimación ilustrativa según tus números. No son ingresos garantizados de HelloPx.</p>
      </div>
    </div>
  )
}
