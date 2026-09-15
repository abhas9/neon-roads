import type { RoadDef } from '../worldTypes';

// World 4 — Ion Drift: slippery ice and boost pads.
export const W4: RoadDef[] = [
  {
    name: 'Static',
    gravity: 500,
    oxygen: 75,
    fuel: 1200,
    rows: `
=======*30
iiiiiii*30
=======*14
..iii..*24
..===..*10
...===.*6
....===*6
....iii*24
....===*10
...===.*6
..===..*6
iiiiiii*10
iiH.Hii*10
iiiiiii*10
=======*12
i.i.i.i*1
iiiiiii*20
HHiiiHH*20
=======*14
.iiiii.*20
..iii..*20
...i...*16
..===..*30
`,
  },
  {
    name: 'Slipstream',
    gravity: 500,
    oxygen: 60,
    fuel: 1300,
    rows: `
=======*20
bbbbbbb*10
=======*16
.......*8
==bbb==*14
.......*11
=======*16
kkkkkkk*6
=======*10
..bbb..*12
.......*10
..===..*12
b=====b*6
bb===bb*6
.......*8
=======*14
===b===*20
HHH=HHH*6
=======*10
bbbbbbb*16
.......*12
=======*40
`,
  },
  {
    name: 'Overdrive',
    gravity: 600,
    oxygen: 55,
    fuel: 1100,
    rows: `
=======*16
bbbbbbb*14
iiiiiii*20
..iii..*20
.......*6
..bbb..*10
..iii..*14
H.iii.H*10
=======*10
===b===*10
x=====x*14
xx=b=xx*10
xxxixxx*20
=======*12
.......*6
iiiiiii*16
iiiHiii*6
iiiiiii*14
bbbbbbb*8
.......*9
iiiiiii*16
=======*6
HHHTHHH*16
bbbbbbb*10
=======*30
`,
  },
];

// World 5 — Tar Nebula: heavy gravity and sticky tar.
export const W5: RoadDef[] = [
  {
    name: 'Molasses',
    gravity: 800,
    oxygen: 80,
    fuel: 1200,
    rows: `
=======*30
kkkkkkk*14
=======*24
kk===kk*20
=======*10
.......*3
=======*12
kkkkkkk*6
=======*8
.......*3
=======*20
k=k=k=k*20
=======*16
kkk=kkk*30
==h=h==*6
=======*14
.......*4
===k===*16
=======*14
kkkkkkk*4
=======*6
.......*4
=======*30
`,
  },
  {
    name: 'Short Hops',
    gravity: 1300,
    oxygen: 70,
    fuel: 1200,
    rows: `
=======*30
.......*1
=======*14
.......*2
=======*14
.......*2
=======*18
{
===.===
===.===
=======
=======
=======
.......
=======
=======
=======
=======
}*4
..===..*10
..=.=..*14
.==.==.*10
.=...=.*14
.==.==.*8
..=.=..*10
..===..*10
.......*2
===.===*14
=h=h=h=*8
=======*10
.......*2
=======*12
.=.=.=.*8
=======*6
.......*2
=======*30
`,
  },
  {
    name: 'Deadweight',
    gravity: 1100,
    oxygen: 75,
    fuel: 1000,
    rows: `
=======*24
kkkkkkk*6
=======*16
.......*2
=======*14
=hhhhh=*10
=======*12
kk===kk*10
kk...kk*8
kk===kk*8
=======*16
.......*2
kkkkkkk*6
=======*20
hhh.hhh*14
=======*12
xxx=xxx*10
kkk=kkk*10
=======*18
.......*2
=======*20
=k=k=k=*16
=======*10
HHH=HHH*10
=======*30
`,
  },
];

// World 6 — Orbital Yard: stacked structures, pipes, platforms at height.
export const W6: RoadDef[] = [
  {
    name: 'Scaffold',
    gravity: 500,
    oxygen: 80,
    fuel: 1200,
    rows: `
=======*24
hhhhhhh*10
HHHHHHH*14
.......*6
HHHHHHH*14
hhhhhhh*10
=======*14
..hhh..*10
..HHH..*14
.......*6
..HHH..*10
..hhh..*6
.......*4
..===..*16
HHH=HHH*10
hhh=hhh*10
===h===*14
===H===*14
===.===*6
===H===*14
=======*14
g.g.g.g*10
.G.G.G.*10
=======*30
`,
  },
  {
    name: 'Pipeline',
    gravity: 400,
    oxygen: 80,
    fuel: 1200,
    rows: `
=======*24
ttttttt*30
=======*14
.t.t.t.*24
=======*12
..ttt..*20
.......*8
..ttt..*20
=======*14
ttt=ttt*24
.......*6
TTTTTTT*14
=======*16
t.t.t.t*30
=======*30
`,
  },
  {
    name: 'Loading Dock',
    gravity: 600,
    oxygen: 75,
    fuel: 1200,
    rows: `
=======*24
HHH.hhh*16
=======*12
...===.*8
..HHH..*14
..=====*10
tttH===*20
=======*10
.......*5
hhhhhhh*14
hhHHHhh*14
hhhhhhh*6
.......*5
=======*10
=T=T=T=*16
=======*10
gggGGGG*10
GGGGggg*10
=======*10
.......*6
=======*30
`,
  },
];

// World 7 — Shatterfield: the oxygen clock.
export const W7: RoadDef[] = [
  {
    name: 'Countdown',
    gravity: 500,
    oxygen: 29,
    fuel: 1400,
    rows: `
=======*40
==H====*10
=======*20
=====H=*10
=======*20
.......*4
=======*30
=H===H=*10
=======*30
H=====H*20
=======*20
.......*6
=======*30
===H===*10
=======*20
==H=H==*10
=======*40
.......*6
=======*50
`,
  },
  {
    name: 'Debris Run',
    gravity: 500,
    oxygen: 40,
    fuel: 1400,
    rows: `
=======*30
bbbbbbb*6
=======*10
=H=====*4
=======*8
====H==*4
=======*8
==H====*4
=======*8
=====H=*4
=======*8
H==H==H*4
=======*10
.......*6
=======*10
=h=====*3
=======*8
====h==*3
=======*8
bbbbbbb*6
=======*14
H=H=H=H*4
=======*12
=H=H=H=*4
=======*14
.......*8
=======*10
==HHH==*6
=======*14
HH===HH*6
=======*40
`,
  },
  {
    name: 'Last Breath',
    gravity: 500,
    oxygen: 14,
    fuel: 1600,
    rows: `
=======*30
=======*60
s......*1
=......*6
=======*80
......s*1
......=*8
=======*80
...s...*1
...=...*4
..===..*80
.......*4
s=====s*3
=======*80
..xxx..*2
xxxsxxx*2
=======*60
`,
  },
];
