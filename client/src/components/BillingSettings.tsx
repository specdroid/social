import { useState, useEffect } from 'react'
import { CreditCard, Crown, ArrowRight } from 'lucide-react'
import { useApi } from '../hooks/useApi'

interface SubscriptionStatus {
  tier: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  expiresAt: string | null
  stripeStatus: unknown | null
}

export function BillingSettings() {
  const { get, post } = useApi()
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)

  useEffect(() => {
    loadStatus()
  }, [])

  async function loadStatus() {
    try {
      const data = await get<SubscriptionStatus>('/api/billing/status')
      setSubscription(data)
    } catch {
      // handle error
    }
  }

  async function handleUpgrade() {
    setCheckoutLoading(true)
    try {
      const data = await post<{ url: string }>('/api/billing/checkout')
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setCheckoutLoading(false)
    }
  }

  async function handlePortal() {
    setCheckoutLoading(true)
    try {
      const data = await post<{ url: string }>('/api/billing/portal')
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setCheckoutLoading(false)
    }
  }

  const isPremium = subscription?.tier === 'premium'
  const isExpired = subscription?.expiresAt && new Date(subscription.expiresAt) < new Date()

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-zinc-50">Billing & Subscription</h2>
        <p className="text-zinc-400 text-sm mt-1">Manage your plan and payment details</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <CreditCard className="w-5 h-5 text-zinc-400" />
          <div>
            <p className="text-sm font-medium text-zinc-50">Current Plan</p>
          </div>
        </div>

        <div className="space-y-4">
          {isPremium && !isExpired ? (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Premium Active</span>
              </div>
              {subscription?.expiresAt && (
                <p className="text-sm text-zinc-400 mt-2">
                  Renews on {new Date(subscription.expiresAt).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-zinc-500" />
                <span className="text-zinc-300 font-medium">Free Plan</span>
              </div>
              <p className="text-sm text-zinc-500 mt-2">
                Upgrade to Premium for automated scheduling, mass DM flows, and advanced automation rules.
              </p>
            </div>
          )}

          {isPremium && !isExpired ? (
            <button
              onClick={handlePortal}
              disabled={checkoutLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              Manage Subscription
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleUpgrade}
              disabled={checkoutLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {checkoutLoading ? 'Redirecting...' : 'Upgrade to Premium'}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-lg">
        <h3 className="text-lg font-semibold text-zinc-50 mb-4">Plan Comparison</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Basic automation rules</span>
            <span className="text-zinc-50">Free</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">WhatsApp auto-responder</span>
            <span className="text-zinc-50">Free</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Content scheduling</span>
            <span className="text-emerald-400 font-medium">Premium</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Mass DM flows</span>
            <span className="text-emerald-400 font-medium">Premium</span>
          </div>
        </div>
      </div>
    </div>
  )
}
