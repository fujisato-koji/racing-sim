// 地球儀に出す、実在のサーキットの場所と短い紹介。
// 緯度と経度は tools/track-list.ts の探す範囲の中心（OpenStreetMap で確かめたサーキットの中心付近）。

export interface Place {
  lat: number;
  lon: number;
  /** 所在地 */
  place: string;
  /** 開場の年 */
  opened: number;
  /** 紹介（名所のコーナーなど） */
  blurb: string;
}

export const PLACES: Record<string, Place> = {
  suzuka: { lat: 34.8431, lon: 136.5407, place: 'Suzuka, Mie, Japan', opened: 1962, blurb: 'A rare figure-eight layout with a crossover bridge. Known for the S curves and the fast 130R.' },
  spa: { lat: 50.4372, lon: 5.9714, place: 'Ardennes forest, Belgium', opened: 1921, blurb: 'A long circuit over forested hills. Famous for Eau Rouge and Raidillon, a sharp climb out of the valley floor.' },
  monza: { lat: 45.6156, lon: 9.2811, place: 'Monza Park, north of Milan, Italy', opened: 1922, blurb: 'Known as the Temple of Speed. Long straights, chicanes, and the big right-hander Parabolica at the end of the lap.' },
  silverstone: { lat: 52.0786, lon: -1.0169, place: 'Northamptonshire, England, UK', opened: 1948, blurb: 'Built on a former airfield. The fast direction changes from Maggotts to Becketts are the highlight.' },
  fuji: { lat: 35.3717, lon: 138.9275, place: 'Oyama, Shizuoka, Japan (at the foot of Mt. Fuji)', opened: 1966, blurb: 'A main straight about 1.5 km long, with Mt. Fuji in view ahead.' },
  zandvoort: { lat: 52.3888, lon: 4.5409, place: 'North Sea coastal dunes, Netherlands', opened: 1948, blurb: 'Follows the rise and fall of the dunes, with banked corners.' },
  'brands-hatch': { lat: 51.3569, lon: 0.2631, place: 'Kent, England, UK', opened: 1926, blurb: 'Famous for Paddock Hill Bend, a corner that drops into a valley. Big elevation changes.' },
  hungaroring: { lat: 47.5789, lon: 19.2486, place: 'Near Budapest, Hungary', opened: 1986, blurb: 'A twisty circuit on a valley slope, known for being hard to overtake on.' },
  tsukuba: { lat: 36.1508, lon: 139.92, place: 'Shimotsuma, Ibaraki, Japan', opened: 1970, blurb: 'A short circuit of about 2 km, a popular place to compare lap times of road cars.' },
  'laguna-seca': { lat: 36.5843, lon: -121.7535, place: 'Monterey, California, USA', opened: 1957, blurb: 'Famous for the Corkscrew, a left-right sequence dropping steeply from the crest of a hill.' },
  monaco: { lat: 43.7347, lon: 7.4206, place: 'Monte Carlo, Monaco', opened: 1929, blurb: 'Run on the city streets: narrow roads lined with guardrails, a hairpin and a tunnel by the sea.' },
  macau: { lat: 22.199, lon: 113.55, place: 'Macau, China', opened: 1954, blurb: 'A street circuit with fast sections along the sea and narrow, winding sections up in the hills.' },
  singapore: { lat: 1.2914, lon: 103.864, place: 'Marina Bay, Singapore', opened: 2008, blurb: 'A street circuit raced at night under floodlights, with many right-angle corners.' },
  baku: { lat: 40.3725, lon: 49.8533, place: 'Baku, Azerbaijan', opened: 2016, blurb: 'A narrow section along the old city walls and a long full-throttle run beside the sea.' },
  melbourne: { lat: -37.8497, lon: 144.968, place: 'Melbourne, Australia', opened: 1996, blurb: 'Uses the roads around a park lake, with a run of fast, flowing corners.' },
  indianapolis: { lat: 39.795, lon: -86.2347, place: 'Indiana, USA', opened: 1909, blurb: 'A nearly rectangular oval known as the Brickyard. Home of the Indianapolis 500.' },
  daytona: { lat: 29.1852, lon: -81.0705, place: 'Daytona Beach, Florida, USA', opened: 1959, blurb: 'A high-speed oval with steep banking. Home of the Daytona 500.' },
  talladega: { lat: 33.5667, lon: -86.0667, place: 'Alabama, USA', opened: 1969, blurb: 'The longest oval in NASCAR, with the steepest banking. Cars run in packs.' },
  charlotte: { lat: 35.3527, lon: -80.6828, place: 'Concord, North Carolina, USA', opened: 1960, blurb: 'A 1.5-mile quad-oval. Also known for its night races.' },
  bristol: { lat: 36.5157, lon: -82.257, place: 'Tennessee, USA', opened: 1961, blurb: 'A small half-mile oval with steep banking, like racing around the inside of a bowl.' },
};
