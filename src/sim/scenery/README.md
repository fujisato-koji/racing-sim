# 遠景の地形データ

`*.json` は、各コースの中心から同心円の格子（半径 150 m から 30 km まで 64 段、角度 256 分割）で取った標高です。`tools/fetch-scenery.ts` が作ります。

- 元データ：Terrain Tiles（https://registry.opendata.aws/terrain-tiles/ 、terrarium 形式、ズーム 11）、2026-10-24 取得
- 表示の決まり：https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- 各ファイルの `source.attribution` に、そのコースの地域に効く提供元の表示を入れています。主なものは次のとおりです。
  - 3DEP, SRTM and GMTED2010 data courtesy of the U.S. Geological Survey
  - ETOPO1: U.S. National Oceanic and Atmospheric Administration
  - Produced using Copernicus data and information funded by the European Union - EU-DEM layers
  - © Environment Agency copyright and/or database right 2015. All rights reserved
  - © Commonwealth of Australia (Geoscience Australia) 2017
