import type { Player } from '../types'

export const players = {
  roffle: {
    id: 'roffle',
    name: 'Roffle',
    division: 'Blue',
    picture: '/images/players/roffle.png',
    socials: {
      twitch: 'roffle',
      youtube: 'RoffleLite',
    },
  },
  haelian: {
    id: 'haelian',
    name: 'Haelian',
    division: 'Blue',
    picture: '/images/players/haelian.png',
    socials: {
      twitch: 'haelian',
      youtube: 'Haelian',
    },
  },
  zainotv: {
    id: 'zainotv',
    name: 'ZainoTV',
    division: 'Blue',
    picture: '/images/players/zaino.png',
    socials: {
      twitch: 'zainotv',
      youtube: 'ZainoTVLive',
    },
  },
  bear: {
    id: 'bear',
    name: 'Bear',
    division: 'Blue',
    picture: '/images/players/bear.png',
    socials: {
      twitch: 'belenosbear',
      youtube: 'BelenosBear',
    },
  },
  gothic: {
    id: 'gothic',
    name: 'Gothic',
    division: 'Blue',
    picture: '/images/players/gothic.png',
    socials: {
      twitch: 'gothiclorduk',
      youtube: 'GothicLordUK',
    },
  },
  neato: {
    id: 'neato',
    name: 'NEATO',
    division: 'Blue',
    picture: '/images/players/neato.jpg',
    socials: {
      twitch: 'neato',
      youtube: 'neatoqueen',
    },
  },
  drspectred: {
    id: 'drspectred',
    name: 'DrSpectred',
    division: 'Red',
    picture: '/images/players/doc.png',
    socials: {
      twitch: 'drspectred',
      youtube: 'drspectred',
    },
  },
  malf: {
    id: 'malf',
    name: 'MALF',
    division: 'Red',
    picture: '/images/players/malf.png',
    socials: {
      twitch: 'michaelalfox',
      youtube: 'michaelalfox',
    },
  },
  skoottie: {
    id: 'skoottie',
    name: 'Skoottie',
    division: 'Red',
    picture: '/images/players/skoottie.jpg',
    socials: {
      twitch: 'skoottie',
      youtube: 'Skoottie',
    },
  },
  nandre: {
    id: 'nandre',
    name: 'Nandre',
    division: 'Red',
    picture: '/images/players/nandre.jpg',
    socials: {
      twitch: 'nandre',
    },
  },
  edzy: {
    id: 'edzy',
    name: 'Edzy',
    division: 'Red',
    picture: '/images/players/edzy.png',
    socials: {
      twitch: 'edzyttv',
      youtube: 'EdzyTTV',
    },
  },
  seadubbs: {
    id: 'seadubbs',
    name: 'Seadubbs',
    division: 'Red',
    picture: '/images/players/seadubbs.png',
    socials: {
      twitch: 'seadubbs11',
      youtube: 'seadubbs11',
    },
  },
} satisfies Record<string, Player>
