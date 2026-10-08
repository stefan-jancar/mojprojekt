// Zapíše capacitor.config.json – APK načítava aplikáciu z tvojej Vercel adresy (APP_URL).
import { writeFileSync } from 'node:fs';

const url = (process.env.APP_URL || '').trim().replace(/\/$/, '');
if (!/^https:\/\//.test(url)) {
  console.error('Chýba APP_URL (napr. https://moj-priestor.vercel.app). Nastav ju v GitHub → Settings → Secrets and variables → Actions → Variables.');
  process.exit(1);
}

const config = {
  appId: 'sk.mojpriestor.app',
  appName: 'Môj priestor',
  webDir: 'www',
  backgroundColor: '#07070d',
  server: {
    url,
    androidScheme: 'https',
    allowNavigation: [new URL(url).host],
  },
  android: { allowMixedContent: false },
};
writeFileSync('capacitor.config.json', JSON.stringify(config, null, 2));
console.log('capacitor.config.json →', url);
