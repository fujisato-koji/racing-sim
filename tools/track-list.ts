// 取り込む実在のサーキット。中心は OpenStreetMap を探す範囲の目安（緯度、経度）。
// 公式の長さ、幅、バンク角は tools/track-specs.md の出典の値。

export type TrackType = 'international' | 'technical' | 'street' | 'oval';

export interface TrackSource {
  id: string;
  name: string;
  nameJa: string;
  country: string;
  type: TrackType;
  center: [number, number];
  /** 探す半径 [m] */
  radius: number;
  /** 公式の 1 周の長さ [m]（周回を選ぶ目安） */
  length: number;
  /** コース幅 [m] */
  width: number;
  /** レースの向き（ピットロードから決められないときに使う） */
  direction: 'cw' | 'ccw';
  /** オーバルのバンク角 [度]（曲がりと直線） */
  banking?: { turns: number; straights: number };
  /** 標高の出どころ */
  dem: 'gsi' | 'ned10m' | 'eudem25m' | 'srtm30m' | 'flat';
  laps: number;
}

export const TRACK_SOURCES: TrackSource[] = [
  // 国際サーキット（高速）
  { id: 'suzuka', name: 'Suzuka', nameJa: '鈴鹿', country: 'JPN', type: 'international', center: [34.8431, 136.5407], radius: 2000, length: 5807, width: 13, direction: 'cw', dem: 'gsi', laps: 2 },
  { id: 'spa', name: 'Spa-Francorchamps', nameJa: 'スパ・フランコルシャン', country: 'BEL', type: 'international', center: [50.4372, 5.9714], radius: 3200, length: 7004, width: 13, direction: 'cw', dem: 'eudem25m', laps: 2 },
  { id: 'monza', name: 'Monza', nameJa: 'モンツァ', country: 'ITA', type: 'international', center: [45.6156, 9.2811], radius: 2600, length: 5793, width: 13, direction: 'cw', dem: 'eudem25m', laps: 2 },
  { id: 'silverstone', name: 'Silverstone', nameJa: 'シルバーストン', country: 'GBR', type: 'international', center: [52.0786, -1.0169], radius: 2200, length: 5891, width: 15, direction: 'cw', dem: 'eudem25m', laps: 2 },
  { id: 'fuji', name: 'Fuji Speedway', nameJa: '富士スピードウェイ', country: 'JPN', type: 'international', center: [35.3717, 138.9275], radius: 2200, length: 4563, width: 15, direction: 'cw', dem: 'gsi', laps: 3 },
  // テクニカル（中小）
  { id: 'zandvoort', name: 'Zandvoort', nameJa: 'ザントフォールト', country: 'NLD', type: 'technical', center: [52.3888, 4.5409], radius: 1800, length: 4259, width: 12, direction: 'cw', dem: 'eudem25m', laps: 3 },
  { id: 'brands-hatch', name: 'Brands Hatch', nameJa: 'ブランズハッチ', country: 'GBR', type: 'technical', center: [51.3569, 0.2631], radius: 1500, length: 3916, width: 11, direction: 'cw', dem: 'eudem25m', laps: 3 },
  { id: 'hungaroring', name: 'Hungaroring', nameJa: 'ハンガロリンク', country: 'HUN', type: 'technical', center: [47.5789, 19.2486], radius: 1800, length: 4381, width: 12, direction: 'cw', dem: 'eudem25m', laps: 3 },
  { id: 'tsukuba', name: 'Tsukuba', nameJa: '筑波', country: 'JPN', type: 'technical', center: [36.1508, 139.9200], radius: 1500, length: 2045, width: 11, direction: 'cw', dem: 'gsi', laps: 5 },
  { id: 'laguna-seca', name: 'Laguna Seca', nameJa: 'ラグナ・セカ', country: 'USA', type: 'technical', center: [36.5843, -121.7535], radius: 1800, length: 3602, width: 12, direction: 'ccw', dem: 'ned10m', laps: 3 },
  // 市街地
  { id: 'monaco', name: 'Monaco', nameJa: 'モナコ', country: 'MCO', type: 'street', center: [43.7347, 7.4206], radius: 1600, length: 3337, width: 9, direction: 'cw', dem: 'eudem25m', laps: 3 },
  { id: 'macau', name: 'Macau Guia', nameJa: 'マカオ（ギア）', country: 'MAC', type: 'street', center: [22.1990, 113.5500], radius: 2200, length: 6120, width: 9, direction: 'cw', dem: 'srtm30m', laps: 2 },
  // 標高の SRTM には建物の高さが混ざる。実際はほぼ平らなので平らにする
  { id: 'singapore', name: 'Marina Bay', nameJa: 'マリーナベイ', country: 'SGP', type: 'street', center: [1.2914, 103.8640], radius: 1800, length: 4927, width: 12, direction: 'ccw', dem: 'flat', laps: 2 },
  { id: 'baku', name: 'Baku', nameJa: 'バクー', country: 'AZE', type: 'street', center: [40.3725, 49.8533], radius: 2200, length: 6003, width: 10, direction: 'ccw', dem: 'srtm30m', laps: 2 },
  // ロングビーチは公道のコースが OpenStreetMap に載っていないので、アルバートパークにした
  // 公園の木の高さを SRTM が拾うので平らにする（実際の高低差も小さい）
  { id: 'melbourne', name: 'Albert Park', nameJa: 'アルバートパーク', country: 'AUS', type: 'street', center: [-37.8497, 144.9680], radius: 2000, length: 5278, width: 12, direction: 'cw', dem: 'flat', laps: 2 },
  // オーバル
  { id: 'indianapolis', name: 'Indianapolis', nameJa: 'インディアナポリス', country: 'USA', type: 'oval', center: [39.7950, -86.2347], radius: 1800, length: 4023, width: 15, direction: 'ccw', banking: { turns: 9.2, straights: 0 }, dem: 'ned10m', laps: 3 },
  { id: 'daytona', name: 'Daytona', nameJa: 'デイトナ', country: 'USA', type: 'oval', center: [29.1852, -81.0705], radius: 1800, length: 4023, width: 12, direction: 'ccw', banking: { turns: 31, straights: 18 }, dem: 'ned10m', laps: 3 },
  { id: 'talladega', name: 'Talladega', nameJa: 'タラデガ', country: 'USA', type: 'oval', center: [33.5667, -86.0667], radius: 2000, length: 4281, width: 15, direction: 'ccw', banking: { turns: 33, straights: 16.5 }, dem: 'ned10m', laps: 3 },
  // もてぎのオーバルは 2026 年に使用を終え一部が取り壊された（地図にも周回が無い）ので、シャーロットにした
  { id: 'charlotte', name: 'Charlotte', nameJa: 'シャーロット', country: 'USA', type: 'oval', center: [35.3527, -80.6828], radius: 1500, length: 2414, width: 18, direction: 'ccw', banking: { turns: 24, straights: 5 }, dem: 'ned10m', laps: 4 },
  { id: 'bristol', name: 'Bristol', nameJa: 'ブリストル', country: 'USA', type: 'oval', center: [36.5157, -82.2570], radius: 1000, length: 858, width: 12, direction: 'ccw', banking: { turns: 26, straights: 6 }, dem: 'ned10m', laps: 8 },
];
