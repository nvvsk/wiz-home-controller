interface SignalStrengthProps {
  rssi?: number
}

export default function SignalStrength({ rssi }: SignalStrengthProps) {
  // No reading yet (e.g. just after server restart, before first push) →
  // show greyed-out bars instead of an alarming "Unknown" label.
  if (rssi === undefined) {
    return (
      <div className="flex items-end space-x-1" title="Waiting for signal report…">
        {[1, 2, 3, 4].map((bar) => (
          <div
            key={bar}
            className="w-1 rounded-sm bg-gray-300"
            style={{ height: `${bar * 4}px`, opacity: 0.3 }}
          />
        ))}
      </div>
    )
  }

  const getSignalInfo = (rssi: number) => {
    if (rssi > -50) return { bars: 4, color: 'bg-green-500', label: 'Excellent' }
    if (rssi > -60) return { bars: 3, color: 'bg-blue-500', label: 'Good' }
    if (rssi > -70) return { bars: 2, color: 'bg-yellow-500', label: 'Fair' }
    return { bars: 1, color: 'bg-red-500', label: 'Weak' }
  }

  const { bars, color, label } = getSignalInfo(rssi)

  return (
    <div className="flex items-end space-x-1" title={`${label} (${rssi} dBm)`}>
      {[1, 2, 3, 4].map((bar) => (
        <div
          key={bar}
          className={`w-1 rounded-sm ${
            bar <= bars ? color : 'bg-gray-300'
          }`}
          style={{
            height: `${bar * 4}px`,
            opacity: bar <= bars ? 1 : 0.3
          }}
        />
      ))}
    </div>
  )
}
