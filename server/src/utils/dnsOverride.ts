import dns from 'node:dns'
import { Resolver } from 'node:dns/promises'

const OVERRIDE_HOSTS = new Set([
  'web.whatsapp.com',
  'mmg.whatsapp.net',
  'mmg-prod.whatsapp.net',
])

const RESOLVER = new Resolver()
RESOLVER.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1'])

const ORIG_LOOKUP = dns.lookup

dns.lookup = ((hostname: string, options: any, callback?: any) => {
  const clean = hostname.replace(/^(wss?|https?):\/\//i, '')
  const base = clean.split(':')[0].split('/')[0]

  if (OVERRIDE_HOSTS.has(base)) {
    if (typeof options === 'function') {
      callback = options
      options = { family: 4, hints: 0, all: false }
    } else if (typeof options === 'number') {
      options = { family: options, hints: 0, all: false }
    }

    if (typeof callback === 'function') {
      RESOLVER.resolve4(base).then(([address]) => {
        if (address) {
          if ((options as dns.LookupOptions).all) {
            callback(null, [{ address, family: 4 }])
          } else {
            callback(null, address, 4)
          }
        } else {
          callback(new Error('Could not resolve ' + base), '', 4)
        }
      }).catch((err) => {
        callback(err, '', 4)
      })
    }
    return { cancel: () => {} }
  }

  if (typeof options === 'number') {
    return ORIG_LOOKUP(hostname, options, callback) as unknown as { cancel?: () => void }
  }
  return ORIG_LOOKUP(hostname, options, callback) as unknown as { cancel?: () => void }
}) as unknown as typeof dns.lookup
