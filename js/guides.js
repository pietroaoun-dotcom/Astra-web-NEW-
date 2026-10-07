// Coaching guides: general Dota 2 practice methods (not statistics). Each links to a focus area so the
// Train page can put the guides for your weakest areas first. Videos are YouTube searches, which always
// return current content, instead of fixed links that go stale between patches.
export const GUIDES = [
  {
    id: 'deaths', area: 'deaths', title: 'Die less without playing passive',
    why: 'A death costs gold, experience, map pressure and often an objective. Most deaths come from a handful of repeatable habits.',
    steps: [
      'Before leaving your lane or jungle, count the enemy heroes visible on the minimap. If two or more are missing, do not walk into fog alone.',
      'Carry a teleport scroll at all times after the laning stage. Most "unlucky" deaths are deaths without an escape option.',
      'When you are the farthest hero from your team on the minimap, you are the target. Farm the lane closest to your team instead.',
      'After every death, say the cause in one word: greedy, caught, fight, vision. Two of the same word in one game means change that habit now.',
      'In fights, wait for the enemy to use their key disable on someone else before you commit.',
    ],
    drill: 'For three games, say the cause of every death out loud (or to Astra: "note died, caught"). Review the notes after the game: which word repeats?',
    watch: ['dota 2 how to stop dying', 'dota 2 map awareness guide', 'dota 2 positioning in teamfights'],
  },
  {
    id: 'farm', area: 'farm', title: 'Farm faster and more consistently',
    why: 'Gold is the resource you control most directly. A steady farm pattern beats occasional big games.',
    steps: [
      'Lane: last-hit first, deny second. Track how many last hits you have at 5 and 10 minutes every game.',
      'After laning, always move toward the next gold: a wave, then a camp on the way, then the next wave. Never walk empty-handed.',
      'Stack camps when you pass them at the right time (around xx:53) and clear them later.',
      'Push out the lane farthest from the enemy, then farm the jungle on your side of the map.',
      'Buy your farming item first if your hero has one, and do not stop to fight unless the fight is near and your team needs you.',
    ],
    drill: 'Demo Hero mode, your main hero, 10 minutes with no items bought on purpose. Count last hits. Repeat weekly and beat your number.',
    watch: ['dota 2 farming patterns guide', 'dota 2 last hitting practice', 'dota 2 how to stack camps'],
  },
  {
    id: 'tilt', area: 'tilt', title: 'Stop losses from snowballing (tilt)',
    why: 'Results right after a loss are where tilt shows up. Queueing angry repeats the same mistakes.',
    steps: [
      'Rule of two: after two losses in a row, stop ranked for the day or take a 30 minute break.',
      'After any loss, stand up for five minutes before queueing. Drink water.',
      'Mute anyone who flames in the first minute. Talking back costs focus, not them.',
      'Before the next game, name one thing you will do differently, and only one.',
    ],
    drill: 'For a week, track your mood from 1 to 5 before each game (tell Astra: "remember I queue tilted after losses"). Do not queue below 3.',
    watch: ['dota 2 tilt mental game', 'how to stop tilting in ranked games'],
  },
  {
    id: 'session', area: 'session', title: 'Shorter, sharper sessions',
    why: 'Focus drops over a long session, and so do results.',
    steps: [
      'Decide your number of games before you start (three is a good default).',
      'Stop on a win when you can: ending on a good game helps the next session too.',
      'Play your most important games in your best time window (see your Coach page).',
    ],
    drill: 'Set a three-game limit for one week and compare your results with the week before on the Coach page.',
    watch: ['dota 2 how to climb mmr consistently'],
  },
  {
    id: 'laning', area: 'deaths', title: 'Win your lane',
    why: 'A good lane sets up your whole game, and a lost lane is where many deaths and farm problems start.',
    steps: [
      'Check the enemy laners before the horn and decide who wins the lane at level 1, 3 and 6.',
      'Trade hits when the enemy goes for a last hit: they cannot hit you back without losing the creep.',
      'Pull or block creeps to keep the lane near your tower when you are the weaker side.',
      'Watch the minimap at every creep wave: missing heroes mean a gank is coming.',
    ],
    drill: 'Next five games, write your last hits and denies at 10:00 (tell Astra a note). Compare with your Training targets.',
    watch: ['dota 2 laning guide', 'dota 2 creep equilibrium explained', 'dota 2 how to trade in lane'],
  },
  {
    id: 'pool', area: 'pool', title: 'Build a hero pool that climbs',
    why: 'Fewer heroes means more games on each, faster improvement and fewer surprises in the draft.',
    steps: [
      'Pick three main heroes for your role from "Who to play" and play them in most ranked games.',
      'Keep one flexible pick that fits most drafts, and one counter-pick for heroes you hate facing.',
      'Learn new heroes in unranked or Turbo until you have 10 games on them.',
    ],
    drill: 'Play 80% of next week\'s ranked games on your top three heroes and compare the week on the Coach page.',
    watch: ['dota 2 hero pool advice ranked', 'best heroes to climb dota 2'],
  },
  {
    id: 'duration', area: 'duration', title: 'Close games and play long ones well',
    why: 'Your results by game length show whether you lose leads or fall behind early.',
    steps: [
      'When you are ahead, group and take towers and Roshan instead of farming alone.',
      'Use the Aegis to end a lane of barracks, not to farm.',
      'When you are behind, defend high ground, farm safely and fight only near your towers.',
      'Buy buyback gold when the game passes 35 minutes.',
    ],
    drill: 'In your next three long games, note the moment the game turned (tell Astra: "note we lost Roshan").',
    watch: ['dota 2 how to close games', 'dota 2 how to come back from behind'],
  },
  {
    id: 'draft', area: 'pool', title: 'Draft smarter',
    why: 'A good pick is one you play well that is not countered. The Draft page scores both.',
    steps: [
      'Pick your comfort heroes late enough to see what the enemy has.',
      'Avoid picking into a hard counter even if it is your best hero.',
      'Check what your team lacks: disable, a frontliner, or late-game damage.',
    ],
    drill: 'In each draft, say the enemy picks to Astra and pick from its top three suggestions for a week.',
    watch: ['dota 2 drafting guide ranked'],
  },
];

/** Guides for the player's weakest areas first, then the rest. */
export function guidesFor(insights, focus) {
  const order = [];
  if (focus) order.push(focus);
  for (const i of insights) if (i.kind === 'fault') order.push(i.id.split(':')[0]);
  const rank = g => { const i = order.indexOf(g.area); return i === -1 ? 99 : i; };
  return [...GUIDES].sort((a, b) => rank(a) - rank(b));
}
