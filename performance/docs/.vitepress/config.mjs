import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'DIGIT Load Tests',
  description: 'PGR load testing results, database findings, and capacity planning for the DIGIT platform',
  base: '/PGR-load-tests/',

  themeConfig: {
    nav: [
      { text: 'Executive Summary', link: '/executive-summary' },
      { text: 'Findings', link: '/findings' },
      { text: 'Running Tests', link: '/running-tests' },
      {
        text: 'GitHub',
        link: 'https://github.com/ChakshuGautam/PGR-load-tests'
      }
    ],

    sidebar: [
      {
        text: 'Overview',
        items: [
          { text: 'Executive Summary', link: '/executive-summary' },
        ]
      },
      {
        text: 'Results',
        items: [
          { text: 'Detailed Findings', link: '/findings' },
        ]
      },
      {
        text: 'Bomet Run (28 Aug 2026)',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/run-28-08-26/' },
          { text: 'Executive Summary', link: '/run-28-08-26/executive-summary' },
          { text: 'Findings', link: '/run-28-08-26/findings' },
          { text: 'Capacity Planning', link: '/run-28-08-26/recommendations-transition-plan' },
        ]
      },
      {
        text: 'Developer Guide',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Setup', link: '/setup' },
          { text: 'Running Tests', link: '/running-tests' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ChakshuGautam/PGR-load-tests' }
    ],

    search: {
      provider: 'local'
    },

    outline: [2, 3],
  }
})
