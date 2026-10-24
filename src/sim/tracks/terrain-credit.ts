// 遠景の地形（Terrain Tiles）の出典の表示。国ごとに、その地域に効く提供元を並べる。
// 決まりは https://github.com/tilezen/joerd/blob/master/docs/attribution.md（2026-10-24 確認）。

export function terrainAttribution(country: string): string[] {
  const eu = ['BEL', 'ITA', 'NLD', 'HUN', 'MCO', 'AZE'];
  const s: string[] = [];
  if (country === 'GBR') s.push('© Environment Agency copyright and/or database right 2015. All rights reserved', 'Produced using Copernicus data and information funded by the European Union - EU-DEM layers');
  else if (eu.includes(country)) s.push('Produced using Copernicus data and information funded by the European Union - EU-DEM layers');
  if (country === 'AUS') s.push('© Commonwealth of Australia (Geoscience Australia) 2017');
  if (country === 'USA') s.push('3DEP data courtesy of the U.S. Geological Survey');
  s.push('SRTM and GMTED2010 data courtesy of the U.S. Geological Survey', 'ETOPO1: U.S. National Oceanic and Atmospheric Administration');
  return s;
}
