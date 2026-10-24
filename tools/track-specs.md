# 実在のサーキットの値と出典

`tools/track-list.ts` の公式の長さ、向き、オーバルのバンク角の出典。アクセス日はすべて 2026-10-24。
幅は、資料に数値があればその代表値、無ければ（不明）似た種類のコースの値を仮に置いた。

| id | 1 周 [m] | 幅 [m] | 向き | バンク（曲がり / 直線）[度] | 出典 |
|---|---|---|---|---|---|
| suzuka | 5807 | 10–16（13 を使う） | 8 の字 | | https://en.wikipedia.org/wiki/Suzuka_International_Racing_Course 、https://www.suzukacircuit.jp/course_s/ |
| spa | 7004 | 不明（13 を仮置き） | 時計回り | | https://en.wikipedia.org/wiki/Circuit_de_Spa-Francorchamps |
| monza | 5793 | 10–12（13 を仮置き） | 時計回り | | https://en.wikipedia.org/wiki/Monza_Circuit 、https://www.monzanet.it/en/circuit/ |
| silverstone | 5891 | 15（平均） | 時計回り | | https://en.wikipedia.org/wiki/Silverstone_Circuit 、https://www.silverstone.co.uk/news/cycle-silverstone-and-set-your-lap-time-beatthetrack |
| fuji | 4563 | 15–25（15 を使う） | 時計回り | | https://en.wikipedia.org/wiki/Fuji_Speedway 、https://ja.wikipedia.org/wiki/富士スピードウェイ |
| zandvoort | 4259 | 不明（12 を仮置き） | 時計回り | T3 19、T13/14 18（今は路面を傾けていない） | https://en.wikipedia.org/wiki/Circuit_Zandvoort 、https://www.circuitzandvoort.nl/en/presentation/ |
| brands-hatch | 3916 | 不明（11 を仮置き） | 時計回り | | https://en.wikipedia.org/wiki/Brands_Hatch 、https://www.brandshatch.co.uk/about/circuit-layouts |
| hungaroring | 4381 | 10–16（12 を使う） | 時計回り | | https://en.wikipedia.org/wiki/Hungaroring 、https://hungaroring.hu/guidebook/ |
| tsukuba | 2045 | 10–17（11 を使う） | 不明（地図から決めた） | | https://en.wikipedia.org/wiki/Tsukuba_Circuit 、https://ja.wikipedia.org/wiki/筑波サーキット 、https://de.wikipedia.org/wiki/Tsukuba_Circuit |
| laguna-seca | 3602 | 15（第三者資料。12 を使う） | 反時計回り（第三者資料） | | https://en.wikipedia.org/wiki/WeatherTech_Raceway_Laguna_Seca 、https://weathertechraceway.com/pages/track-information |
| monaco | 3337 | 不明（9 を仮置き） | 時計回り | | https://en.wikipedia.org/wiki/Circuit_de_Monaco |
| macau | 6120 | 7–14（9 を使う） | 時計回り | | https://en.wikipedia.org/wiki/Guia_Circuit 、https://ja.wikipedia.org/wiki/ギア・サーキット |
| singapore | 4927（2025 年から） | 不明（12 を仮置き） | 反時計回り | | https://en.wikipedia.org/wiki/Marina_Bay_Street_Circuit |
| baku | 6003 | 最も狭いところ 7.6（10 を仮置き） | 反時計回り | | https://en.wikipedia.org/wiki/Baku_City_Circuit |
| melbourne | 5278 | 不明（12 を仮置き） | 時計回り | | https://en.wikipedia.org/wiki/Albert_Park_Circuit |
| indianapolis | 4023 | 不明（15 を仮置き） | 反時計回り | 9.2 / 0 | https://en.wikipedia.org/wiki/Indianapolis_Motor_Speedway 、https://en.wikipedia.org/wiki/Oval_track_racing |
| daytona | 4023 | 不明（12 を仮置き） | 反時計回り | 31 / 18（トライオーバル）、3（バック） | https://en.wikipedia.org/wiki/Daytona_International_Speedway |
| talladega | 4281 | 不明（15 を仮置き） | 反時計回り | 33 / 16.5（トライオーバル）、2 | https://en.wikipedia.org/wiki/Talladega_Superspeedway |
| charlotte | 2414 | 不明（18 を仮置き） | 反時計回り | 24 / 5 | https://en.wikipedia.org/wiki/Charlotte_Motor_Speedway 、https://www.charlottemotorspeedway.com/fans/track-facts/ |
| bristol | 858 | 12.2（40 ft） | 反時計回り | 24–28 / 5–9 | https://en.wikipedia.org/wiki/Bristol_Motor_Speedway 、https://www.bristolmotorspeedway.com/media/ |

向きの「反時計回り」のうちオーバルは、記事に書かれていないものを https://en.wikipedia.org/wiki/Oval_track_racing の「the direction of traffic is almost universally counterclockwise」で補った。
ゲームでの向きは、OpenStreetMap のピットロードの一方通行の向きから決め、ピットロードが無いときだけこの表の向きを使う。

## 入れ替えたコース

- ロングビーチ：公道のコースが OpenStreetMap に周回として載っていないので、アルバートパークに替えた。
- もてぎのオーバル：2026-05-05 のデモ走行を最後にレースコースとしての使用を終え、2026 年に一部が取り壊された（en.wikipedia、ja.wikipedia）。地図にも周回が無いので、シャーロットに替えた。

## 形と標高のデータ

- 形：OpenStreetMap（© OpenStreetMap contributors、ODbL 1.0）。Overpass API で取得した。使った区間の番号は各 JSON の `source.ways` にある。
- 標高：日本は国土地理院の標高 API（地理院タイルの DEM）、米国は OpenTopoData の NED 10 m、欧州は EU-DEM 25 m、そのほかは SRTM 30 m。シンガポールは SRTM に建物の高さが混ざるので平らにした。
- `src/sim/tracks/*.json` は OpenStreetMap から作ったデータベースなので、ODbL 1.0 で公開する（`src/sim/tracks/README.md`）。
