import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cn.kimiwork.smartrepeater',
  appName: '智能复读机',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
}

export default config
