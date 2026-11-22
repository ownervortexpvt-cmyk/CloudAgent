/**
 * Auto-collect APIs tool — detects what APIs an app needs from its description
 * and automatically creates placeholder secrets for them.
 *
 * When the user says "build a Cloud Agent app" or "build an e-commerce app",
 * this tool:
 *   1. Parses the app description for known service names (Stripe, OpenAI, Firebase, etc.)
 *   2. Detects which API keys are needed for each service
 *   3. Creates placeholder secrets in the project's secret store
 *   4. Tells the agent which env vars to use in the code
 *
 * The user then fills in the actual API key values via the Secrets panel.
 */
import { detectFramework } from '../framework'
import * as storage from '../storage'
import { db } from '../db'
import { ToolDef as Tool, ProjectContext, ToolResult } from './tools'

// Known services and their required API keys
const SERVICE_REGISTRY: Record<string, {
  name: string
  keywords: string[]
  envVars: Array<{ key: string; description: string; docsUrl: string; required: boolean }>
}> = {
  openai: {
    name: 'OpenAI',
    keywords: ['openai', 'gpt', 'chatgpt', 'ai chat', 'ai assistant', 'completion', 'dall-e', 'image generation'],
    envVars: [
      { key: 'OPENAI_API_KEY', description: 'OpenAI API key for GPT/DALL-E', docsUrl: 'https://platform.openai.com/api-keys', required: true },
    ],
  },
  anthropic: {
    name: 'Anthropic Claude',
    keywords: ['claude', 'anthropic', 'claude ai', 'sonnet', 'opus', 'haiku'],
    envVars: [
      { key: 'ANTHROPIC_API_KEY', description: 'Anthropic API key for Claude', docsUrl: 'https://console.anthropic.com/settings/keys', required: true },
    ],
  },
  gemini: {
    name: 'Google Gemini',
    keywords: ['gemini', 'google ai', 'bard', 'palm', 'google generative'],
    envVars: [
      { key: 'GOOGLE_API_KEY', description: 'Google API key for Gemini', docsUrl: 'https://aistudio.google.com/app/apikey', required: true },
    ],
  },
  firebase: {
    name: 'Firebase',
    keywords: ['firebase', 'firestore', 'firebase auth', 'fcm', 'firebase messaging', 'firebase storage', 'realtime database'],
    envVars: [
      { key: 'FIREBASE_API_KEY', description: 'Firebase API key', docsUrl: 'https://console.firebase.google.com/project/_/settings/general', required: true },
      { key: 'FIREBASE_AUTH_DOMAIN', description: 'Firebase auth domain (xxx.firebaseapp.com)', docsUrl: '', required: true },
      { key: 'FIREBASE_PROJECT_ID', description: 'Firebase project ID', docsUrl: '', required: true },
      { key: 'FIREBASE_STORAGE_BUCKET', description: 'Firebase storage bucket (xxx.appspot.com)', docsUrl: '', required: true },
      { key: 'FIREBASE_MESSAGING_SENDER_ID', description: 'Firebase messaging sender ID', docsUrl: '', required: true },
      { key: 'FIREBASE_APP_ID', description: 'Firebase app ID', docsUrl: '', required: true },
    ],
  },
  supabase: {
    name: 'Supabase',
    keywords: ['supabase', 'supabase auth', 'supabase db', 'postgres'],
    envVars: [
      { key: 'SUPABASE_URL', description: 'Supabase project URL', docsUrl: 'https://app.supabase.com/project/_/settings/api', required: true },
      { key: 'SUPABASE_ANON_KEY', description: 'Supabase anon public key', docsUrl: '', required: true },
      { key: 'SUPABASE_SERVICE_KEY', description: 'Supabase service role key (server only)', docsUrl: '', required: false },
    ],
  },
  stripe: {
    name: 'Stripe',
    keywords: ['stripe', 'payment', 'checkout', 'subscription', 'billing', 'credit card'],
    envVars: [
      { key: 'STRIPE_SECRET_KEY', description: 'Stripe secret key (sk_live_... or sk_test_...)', docsUrl: 'https://dashboard.stripe.com/apikeys', required: true },
      { key: 'STRIPE_PUBLISHABLE_KEY', description: 'Stripe publishable key (pk_live_... or pk_test_...)', docsUrl: '', required: true },
      { key: 'STRIPE_WEBHOOK_SECRET', description: 'Stripe webhook signing secret (whsec_...)', docsUrl: '', required: false },
    ],
  },
  razorpay: {
    name: 'Razorpay',
    keywords: ['razorpay', 'indian payment', 'upi payment'],
    envVars: [
      { key: 'RAZORPAY_KEY_ID', description: 'Razorpay key ID', docsUrl: 'https://dashboard.razorpay.com/applications/keys', required: true },
      { key: 'RAZORPAY_KEY_SECRET', description: 'Razorpay key secret', docsUrl: '', required: true },
    ],
  },
  bkash: {
    name: 'bKash',
    keywords: ['bkash', 'b kash', 'bangladeshi payment', 'mobile payment bd'],
    envVars: [
      { key: 'BKASH_APP_KEY', description: 'bKash app key', docsUrl: 'https://developer.bka.sh/', required: true },
      { key: 'BKASH_APP_SECRET', description: 'bKash app secret', docsUrl: '', required: true },
      { key: 'BKASH_USERNAME', description: 'bKash username', docsUrl: '', required: true },
      { key: 'BKASH_PASSWORD', description: 'bKash password', docsUrl: '', required: true },
    ],
  },
  nagad: {
    name: 'Nagad',
    keywords: ['nagad', 'nagad payment'],
    envVars: [
      { key: 'NAGAD_MERCHANT_ID', description: 'Nagad merchant ID', docsUrl: 'https://www.nagad.com.bd/api', required: true },
      { key: 'NAGAD_PUBLIC_KEY', description: 'Nagad public key (PEM)', docsUrl: '', required: true },
      { key: 'NAGAD_PRIVATE_KEY', description: 'Nagad private key (PEM)', docsUrl: '', required: true },
    ],
  },
  google_maps: {
    name: 'Google Maps',
    keywords: ['google maps', 'maps', 'location', 'geolocation', 'places', 'map view'],
    envVars: [
      { key: 'GOOGLE_MAPS_API_KEY', description: 'Google Maps API key', docsUrl: 'https://console.cloud.google.com/google/maps-apis', required: true },
    ],
  },
  onesignal: {
    name: 'OneSignal',
    keywords: ['onesignal', 'push notification', 'push', 'notification'],
    envVars: [
      { key: 'ONESIGNAL_APP_ID', description: 'OneSignal app ID', docsUrl: 'https://onesignal.com/', required: true },
      { key: 'ONESIGNAL_REST_API_KEY', description: 'OneSignal REST API key', docsUrl: '', required: true },
    ],
  },
  twilio: {
    name: 'Twilio (SMS/OTP)',
    keywords: ['twilio', 'sms', 'otp', 'phone verification', 'sms otp'],
    envVars: [
      { key: 'TWILIO_ACCOUNT_SID', description: 'Twilio account SID', docsUrl: 'https://console.twilio.com/', required: true },
      { key: 'TWILIO_AUTH_TOKEN', description: 'Twilio auth token', docsUrl: '', required: true },
      { key: 'TWILIO_PHONE_NUMBER', description: 'Twilio phone number (+1...)', docsUrl: '', required: true },
    ],
  },
  sendgrid: {
    name: 'SendGrid (Email)',
    keywords: ['sendgrid', 'email', 'smtp', 'mail'],
    envVars: [
      { key: 'SENDGRID_API_KEY', description: 'SendGrid API key', docsUrl: 'https://app.sendgrid.com/settings/api_keys', required: true },
      { key: 'SENDGRID_FROM_EMAIL', description: 'From email address', docsUrl: '', required: true },
    ],
  },
  github: {
    name: 'GitHub',
    keywords: ['github', 'git', 'repo', 'repository'],
    envVars: [
      { key: 'GITHUB_TOKEN', description: 'GitHub personal access token', docsUrl: 'https://github.com/settings/tokens', required: true },
    ],
  },
  agora: {
    name: 'Agora (Video Call)',
    keywords: ['agora', 'video call', 'video chat', 'live streaming', 'rtc'],
    envVars: [
      { key: 'AGORA_APP_ID', description: 'Agora app ID', docsUrl: 'https://agora.io/', required: true },
      { key: 'AGORA_APP_CERTIFICATE', description: 'Agora app certificate', docsUrl: '', required: true },
    ],
  },
  cloudinary: {
    name: 'Cloudinary (Image/Video)',
    keywords: ['cloudinary', 'image upload', 'cdn', 'image optimization'],
    envVars: [
      { key: 'CLOUDINARY_CLOUD_NAME', description: 'Cloudinary cloud name', docsUrl: 'https://cloudinary.com/console', required: true },
      { key: 'CLOUDINARY_API_KEY', description: 'Cloudinary API key', docsUrl: '', required: true },
      { key: 'CLOUDINARY_API_SECRET', description: 'Cloudinary API secret', docsUrl: '', required: true },
    ],
  },
  s3: {
    name: 'AWS S3',
    keywords: ['s3', 'aws s3', 'amazon s3', 'file storage', 'bucket'],
    envVars: [
      { key: 'AWS_ACCESS_KEY_ID', description: 'AWS access key ID', docsUrl: 'https://aws.amazon.com/iam/', required: true },
      { key: 'AWS_SECRET_ACCESS_KEY', description: 'AWS secret access key', docsUrl: '', required: true },
      { key: 'AWS_REGION', description: 'AWS region (e.g. us-east-1)', docsUrl: '', required: true },
      { key: 'AWS_S3_BUCKET', description: 'S3 bucket name', docsUrl: '', required: true },
    ],
  },
  mongodb: {
    name: 'MongoDB Atlas',
    keywords: ['mongodb', 'mongo', 'atlas', 'nosql'],
    envVars: [
      { key: 'MONGODB_URI', description: 'MongoDB connection string', docsUrl: 'https://cloud.mongodb.com/', required: true },
    ],
  },
  postgres: {
    name: 'PostgreSQL',
    keywords: ['postgres', 'postgresql', 'pg', 'database url'],
    envVars: [
      { key: 'DATABASE_URL', description: 'PostgreSQL connection string', docsUrl: '', required: true },
    ],
  },
  redis: {
    name: 'Redis',
    keywords: ['redis', 'cache', 'session store'],
    envVars: [
      { key: 'REDIS_URL', description: 'Redis connection URL', docsUrl: '', required: true },
    ],
  },
  figma: {
    name: 'Figma',
    keywords: ['figma', 'design to code', 'figma import'],
    envVars: [
      { key: 'FIGMA_TOKEN', description: 'Figma personal access token', docsUrl: 'https://www.figma.com/settings', required: true },
    ],
  },
  google_analytics: {
    name: 'Google Analytics',
    keywords: ['analytics', 'google analytics', 'ga4', 'tracking'],
    envVars: [
      { key: 'GA_MEASUREMENT_ID', description: 'Google Analytics measurement ID (G-XXXXXX)', docsUrl: 'https://analytics.google.com/', required: true },
    ],
  },
  sentry: {
    name: 'Sentry (Error Tracking)',
    keywords: ['sentry', 'error tracking', 'crash reporting'],
    envVars: [
      { key: 'SENTRY_DSN', description: 'Sentry DSN URL', docsUrl: 'https://sentry.io/', required: true },
    ],
  },
  // The built-in Vortex Engine is always included when building Cloud Agent itself
  zai: {
    name: 'Vortex Engine (built-in)',
    keywords: ['cloud agent', 'z.ai', 'zai', 'glm'],
    envVars: [
      { key: 'ZAI_API_KEY', description: 'GLM API key (optional — built-in works without it)', docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys', required: false },
    ],
  },
}

/**
 * v73: TRULY automatic API collection — server-side, zero model cooperation
 * needed. The tool-based flow required the MODEL to decide to call
 * auto_collect_apis (it usually didn't), which is why "automatic API collect
 * korsena". The run routes now call this BEFORE the agent starts.
 *
 * Scans the prompt for known service keywords and, for every service found
 * that is missing placeholders, creates the secret rows + .env lines.
 * Returns a short note (or null when nothing was detected) that the caller
 * injects into the run so the model knows the secrets exist.
 */
export async function autoCollectApisForPrompt(projectId: string, prompt: string): Promise<string | null> {
  try {
    const desc = (prompt || '').toLowerCase()
    if (!desc) return null
    const detected = Object.entries(SERVICE_REGISTRY).filter(([, s]) =>
      s.keywords.some(kw => desc.includes(kw)))
    if (detected.length === 0) return null

    const created: string[] = []
    const existing: string[] = []
    for (const [, svc] of detected) {
      for (const ev of svc.envVars) {
        try {
          const dup = await db.envVar.findUnique({
            where: { projectId_key: { projectId, key: ev.key } },
          })
          if (dup) { existing.push(ev.key); continue }
          await db.envVar.create({
            data: {
              projectId,
              key: ev.key,
              value: `[PLACEHOLDER — get from ${svc.name}]`,
              isSecret: true,
            },
          })
          try {
            const envText = storage.existsFile(projectId, '.env')
              ? storage.readFile(projectId, '.env')
              : ''
            if (!envText.includes(ev.key + '=')) {
              storage.writeFile(projectId, '.env', envText + `${ev.key}=[get from ${svc.name}: ${ev.docsUrl || 'see docs'}]\n`)
            }
          } catch {}
          created.push(ev.key)
        } catch {}
      }
    }
    if (created.length === 0 && existing.length === 0) return null
    const svcNames = detected.map(([, s]) => s.name).join(', ')
    return [
      `AUTO-COLLECTED APIS (already done for you before this run): detected ${svcNames}.`,
      created.length ? `Placeholder secrets + .env lines CREATED: ${created.join(', ')}.` : '',
      existing.length ? `Already present: ${existing.join(', ')}.` : '',
      `Reference them via process.env.KEY in server code. Do NOT hardcode keys and do NOT call auto_collect_apis again for these.`,
    ].filter(Boolean).join(' ')
  } catch {
    return null // best-effort — never block a run on collection
  }
}

export const AUTO_API_TOOLS: Record<string, Tool> = {
  auto_collect_apis: {
    name: 'auto_collect_apis',
    description: 'Detect what APIs the app needs from its description and auto-create placeholder secrets. Call this BEFORE writing code when building an app that uses external services (Stripe, Firebase, OpenAI, Maps, etc.). The user fills in actual key values via the Secrets panel.',
    parameters: {
      type: 'object',
      properties: {
        appDescription: { type: 'string', description: 'What the app does (e.g. "e-commerce app with Stripe payments and Firebase auth")' },
      },
      required: ['appDescription'],
    },
    async execute(args, ctx) {
      try {
        const desc = (args.appDescription || '').toLowerCase()
        const detectedServices: Array<{
          service: string
          name: string
          envVars: Array<{ key: string; description: string; docsUrl: string; required: boolean }>
        }> = []

        // Detect which services are mentioned
        for (const [serviceId, service] of Object.entries(SERVICE_REGISTRY)) {
          const matched = service.keywords.some(kw => desc.includes(kw))
          if (matched) {
            detectedServices.push({
              service: serviceId,
              name: service.name,
              envVars: service.envVars,
            })
          }
        }

        // Special case: if building "Cloud Agent" itself, include the built-in engine + OpenAI + GitHub
        if (/cloud\s*agent/.test(desc)) {
          const hasZai = detectedServices.some(s => s.service === 'zai')
          if (!hasZai) {
            detectedServices.push({
              service: 'zai',
              name: SERVICE_REGISTRY.zai.name,
              envVars: SERVICE_REGISTRY.zai.envVars,
            })
          }
        }

        if (detectedServices.length === 0) {
          return {
            ok: true,
            output: `No external API services detected in the description.

If your app needs external services, mention them in the description. Supported services:
${Object.values(SERVICE_REGISTRY).map(s => `- ${s.name}: keywords like ${s.keywords.slice(0, 3).join(', ')}`).join('\n')}

The agent can proceed without any external APIs for simple apps.`,
          }
        }

        // Auto-create placeholder secrets for each detected service
        let created = 0
        let skipped = 0
        const results: Array<{ service: string; envVars: Array<{ key: string; status: string }> }> = []

        for (const svc of detectedServices) {
          const envVarResults: Array<{ key: string; status: string }> = []
          for (const ev of svc.envVars) {
            try {
              // Check if secret already exists for this project
              const existing = await db.envVar.findUnique({
                where: { projectId_key: { projectId: ctx.projectId, key: ev.key } },
              })
              if (existing) {
                envVarResults.push({ key: ev.key, status: 'exists' })
                skipped++
                continue
              }
              // Create placeholder secret
              await db.envVar.create({
                data: {
                  projectId: ctx.projectId,
                  key: ev.key,
                  value: `[PLACEHOLDER — get from ${svc.name}]`,
                  isSecret: true,
                },
              })
              // Also write to .env file in project
              const envLine = `${ev.key}=[get from ${svc.name}: ${ev.docsUrl || 'see docs'}]\n`
              try {
                const existingEnv = storage.existsFile(ctx.projectId, '.env')
                  ? storage.readFile(ctx.projectId, '.env')
                  : ''
                if (!existingEnv.includes(ev.key + '=')) {
                  storage.writeFile(ctx.projectId, '.env', existingEnv + envLine)
                }
              } catch {}
              envVarResults.push({ key: ev.key, status: 'created' })
              created++
            } catch (e: any) {
              envVarResults.push({ key: ev.key, status: `error: ${e.message}` })
            }
          }
          results.push({ service: svc.name, envVars: envVarResults })
        }

        const report = `# Auto-Collect APIs — ${detectedServices.length} services detected

${detectedServices.map(s => `## ${s.name}
${s.envVars.map(ev => `- \`${ev.key}\` ${ev.required ? '(required)' : '(optional)'} — ${ev.description}${ev.docsUrl ? `\n  Get it: ${ev.docsUrl}` : ''}`).join('\n')}`).join('\n\n')}

## Summary
- Created: ${created} new secrets
- Already existed: ${skipped}
- Total env vars: ${created + skipped}

## What was done
${results.map(r => `### ${r.service}
${r.envVars.map(ev => `- ${ev.key}: ${ev.status}`).join('\n')}`).join('\n\n')}

## Next steps
1. Open the **Secrets** panel (top-right KeyRound button)
2. Fill in the actual API key values for each placeholder
3. The agent will use these via \`process.env.KEY_NAME\` in the code
4. Run the project — it will pick up the secrets automatically

## Code usage
In your code, reference these secrets as:
\`\`\`
process.env.${detectedServices[0]?.envVars[0]?.key || 'API_KEY'}
\`\`\`
Never hardcode API keys in source files.`

        return {
          ok: true,
          output: report,
          data: {
            servicesDetected: detectedServices.length,
            secretsCreated: created,
            secretsExisting: skipped,
            services: detectedServices.map(s => s.name),
          },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  list_required_apis: {
    name: 'list_required_apis',
    description: 'List all supported external API services and their keywords. Use this to see what services can be auto-detected.',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute(args, ctx) {
      const list = Object.values(SERVICE_REGISTRY).map(s => {
        return `### ${s.name}
**Keywords:** ${s.keywords.join(', ')}
**Env vars:**
${s.envVars.map(ev => `- \`${ev.key}\` ${ev.required ? '(required)' : '(optional)'} — ${ev.description}${ev.docsUrl ? `\n  Docs: ${ev.docsUrl}` : ''}`).join('\n')}`
      }).join('\n\n---\n\n')

      return {
        ok: true,
        output: `# Supported External API Services\n\n${list}\n\n---\n\nUse \`auto_collect_apis\` with an app description to auto-detect and set up the needed APIs.`,
      }
    },
  },
}
