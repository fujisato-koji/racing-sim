# 実在のサーキットのデータ

この中の `*.json` は、OpenStreetMap のデータから作ったコースの中心線と、公開の標高データから作った高さです。

- 形：© OpenStreetMap contributors。このフォルダの JSON は [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/) で公開します。
- 標高：国土地理院（日本）、USGS NED と EU-DEM と SRTM（OpenTopoData 経由）。
- 作り方：`tools/fetch-tracks.ts`。取得日、使った区間の番号、標高の出どころは各 JSON の `source` にあります。
- 公式の長さ、向き、バンク角の出典は `tools/track-specs.md` にあります。
