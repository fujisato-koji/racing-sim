# 実在の建物のデータ

`*.json` は、各コースのまわり（コースの外接の四角 + 120 m）の建物の足元の形と高さです。`tools/fetch-buildings.ts` が作ります。

- 元データ：OpenStreetMap（© OpenStreetMap contributors）を Overpass API で取得（2026-10-24）
- ライセンス：Open Database License (ODbL) 1.0。このフォルダのデータは OpenStreetMap から作った派生データベースなので、同じ ODbL 1.0 で公開します。
- 高さは `height` のタグ、無ければ `building:levels` × 3.2 m、無ければ建物の種類ごとの標準値です。
- 道に重なる建物（トンネルの上の建物など）は除いています。窓の並び、壁と屋根の色は作り物です。
