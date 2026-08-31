/** @type {import("next").NextConfig} */
const config = {
  output: 'standalone',
  async redirects() {
    return [
      { source: '/leaderboard', destination: '/leaderboards', permanent: true },
      { source: '/account', destination: '/profile', permanent: false },
    ]
  },
}

export default config
