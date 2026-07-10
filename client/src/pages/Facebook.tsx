import { FacebookPageManager } from '../components/FacebookPageManager'
import { FacebookWallSetup } from '../components/FacebookWallSetup'

export function Facebook() {
  return (
    <div className="space-y-8">
      <FacebookWallSetup />
      <FacebookPageManager />
    </div>
  )
}
