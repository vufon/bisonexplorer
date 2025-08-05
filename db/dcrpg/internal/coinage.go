package internal

const (
	CreateCoinAgeTable = `CREATE TABLE IF NOT EXISTS coin_age (
		height INT8 PRIMARY KEY,
		time TIMESTAMPTZ,
		coin_days_destroyed FLOAT8,
		avg_coin_days FLOAT8
	);`

	CreateCoinAgeBandsTable = `CREATE TABLE IF NOT EXISTS coin_age_bands (
		height INT8,
		time TIMESTAMPTZ,
		age_band TEXT,
		value INT8,
		UNIQUE (height, age_band)
	);`

	CreateMeanCoinAgeTable = `CREATE TABLE IF NOT EXISTS mca_snapshots (
  		block_height INTEGER PRIMARY KEY,
  		block_time TIMESTAMP NOT NULL,
  		total_coin_days NUMERIC NOT NULL,
  		total_supply BIGINT NOT NULL,
  		mean_coin_age NUMERIC NOT NULL
	);`

	CreateUtxoHistoryTable = `CREATE TABLE IF NOT EXISTS utxo_history (
  		tx_hash TEXT NOT NULL,
  		tx_index INTEGER NOT NULL,
  		value BIGINT NOT NULL,
  		create_time TIMESTAMP NOT NULL,
  		create_height INTEGER NOT NULL,
  		spend_time TIMESTAMP,
  		spend_height INTEGER,
  		PRIMARY KEY (tx_hash, tx_index)
	);`

	IndexUtxoHistoryCreateHeightSpendHeight = `CREATE INDEX IF NOT EXISTS idx_utxo_create_spend_height
		ON utxo_history (create_height, spend_height);`

	IndexUtxoHistorySpendHeightIsNull = `CREATE INDEX IF NOT EXISTS idx_utxo_spend_null
		ON utxo_history (spend_height)
		WHERE spend_height IS NULL;`

	IndexUtxoHistoryCreateTimeValue = `CREATE INDEX IF NOT EXISTS idx_utxo_create_time_value
		ON utxo_history (create_time, value);`

	IndexUtxoHistoryTxHash = `CREATE INDEX IF NOT EXISTS idx_utxo_tx_hash
		ON utxo_history (tx_hash);`

	InsertUtxoHistoryRow = `INSERT INTO utxo_history (tx_hash, tx_index, value, create_time, create_height)
			SELECT vout.tx_hash, vout.tx_index, vout.value, blk.time, blk.height
			FROM vouts vout
			JOIN transactions tx ON vout.tx_hash = tx.tx_hash
			JOIN blocks blk ON tx.block_hash = blk.hash
			WHERE blk.height = $1 AND tx.is_mainchain
			ON CONFLICT DO NOTHING`

	UpdateSpentUtxo = `UPDATE utxo_history
			SET spend_time = blk.time,
			    spend_height = blk.height
			FROM vins
			JOIN transactions tx ON vins.tx_hash = tx.tx_hash
			JOIN blocks blk ON tx.block_hash = blk.hash
			WHERE blk.height = $1
			  AND tx.is_mainchain
			  AND vins.prev_tx_hash = utxo_history.tx_hash
			  AND vins.prev_tx_index = utxo_history.tx_index`

	SelectCoinAgeBandsFromUtxoHistory = `SELECT
  blk.height AS block_height,
  blk.time AS block_time,
  band_data.age_band,
  SUM(band_data.value) AS total_value
FROM blocks blk
JOIN LATERAL (
  SELECT
    CASE
      WHEN FLOOR(EXTRACT(EPOCH FROM (blk.time - u.create_time)) / 86400) < 1 THEN '<1d'
      WHEN FLOOR(EXTRACT(EPOCH FROM (blk.time - u.create_time)) / 86400) < 7 THEN '1d-1w'
      WHEN FLOOR(EXTRACT(EPOCH FROM (blk.time - u.create_time)) / 86400) < 30 THEN '1w-1m'
      WHEN FLOOR(EXTRACT(EPOCH FROM (blk.time - u.create_time)) / 86400) < 180 THEN '1m-6m'
      WHEN FLOOR(EXTRACT(EPOCH FROM (blk.time - u.create_time)) / 86400) < 365 THEN '6m-1y'
      WHEN FLOOR(EXTRACT(EPOCH FROM (blk.time - u.create_time)) / 86400) < 2 * 365 THEN '1y-2y'
      WHEN FLOOR(EXTRACT(EPOCH FROM (blk.time - u.create_time)) / 86400) < 3 * 365 THEN '2y-3y'
      WHEN FLOOR(EXTRACT(EPOCH FROM (blk.time - u.create_time)) / 86400) < 5 * 365 THEN '3y-5y'
      WHEN FLOOR(EXTRACT(EPOCH FROM (blk.time - u.create_time)) / 86400) < 7 * 365 THEN '5y-7y'
      ELSE '>7y'
    END AS age_band,
    u.value
  FROM utxo_history u
  WHERE u.create_height <= blk.height
    AND (u.spend_height IS NULL OR u.spend_height > blk.height)
) AS band_data ON TRUE
WHERE blk.is_mainchain
  AND blk.height BETWEEN $1 AND $2
GROUP BY blk.height, blk.time, band_data.age_band
ORDER BY blk.height, band_data.age_band`

	SelectMeanCoinAgeSnapshotsFromUtxoHistory = `SELECT
  b.height AS block_height,
  b.time AS block_time,
  SUM(u.value * EXTRACT(EPOCH FROM (b.time - u.create_time)) / 86400) AS total_coin_days,
  SUM(u.value) AS total_supply,
  SUM(u.value * EXTRACT(EPOCH FROM (b.time - u.create_time)) / 86400) / NULLIF(SUM(u.value), 0) AS mean_coin_age
FROM blocks b
JOIN utxo_history u
  ON u.create_height <= b.height
  AND (u.spend_height IS NULL OR u.spend_height > b.height)
WHERE b.height BETWEEN $1 AND $2
GROUP BY b.height, b.time
ORDER BY b.height;`

	SelectUtxoHistoryMaxHeight = `SELECT COALESCE(MAX(create_height), -1) FROM utxo_history`

	SelectCoinAgeMaxHeight = `SELECT COALESCE(MAX(height), 0) FROM coin_age`

	SelectCoinAgeBandsMaxHeight = `SELECT COALESCE(MAX(height), 0) FROM coin_age_bands`
	SelectMcaSnapshotsMaxHeight = `SELECT COALESCE(MAX(block_height), 0) FROM mca_snapshots`

	SelectCoinAgeAllRows = `SELECT * FROM coin_age WHERE height > $1 ORDER BY height`
	InsertCoinAgeRow     = `INSERT INTO coin_age (height, time, coin_days_destroyed, avg_coin_days) VALUES ($1, $2, $3, $4)`
	UpsertCoinAgeRow     = `INSERT INTO coin_age (height, time, coin_days_destroyed, avg_coin_days)
								VALUES ($1, $2, $3, $4)
								ON CONFLICT (height) DO UPDATE 
							SET 
    						coin_days_destroyed = EXCLUDED.coin_days_destroyed,
    						avg_coin_days = EXCLUDED.avg_coin_days`

	UpsertMCASnapshotRow = `INSERT INTO mca_snapshots (block_height, block_time, total_coin_days, total_supply, mean_coin_age)
								VALUES ($1, $2, $3, $4, $5)
								ON CONFLICT (block_height) DO UPDATE 
							SET 
    						total_coin_days = EXCLUDED.total_coin_days,
    						total_supply = EXCLUDED.total_supply,
							mean_coin_age = EXCLUDED.mean_coin_age`

	UpsertCoinAgeBandsRow              = `INSERT INTO coin_age_bands (height, time, age_band, value) VALUES ($1, $2, $3, $4) ON CONFLICT(height, age_band) DO NOTHING`
	SelectCoinAgeBandsAllRows          = `SELECT * FROM coin_age_bands WHERE height > $1 ORDER BY height`
	SelectRemainingCoinAgeBandsHeights = `WITH all_heights AS (
  SELECT generate_series(1, $1) AS height
),
existing_heights AS (
  SELECT DISTINCT height FROM coin_age_bands
)
SELECT a.height
FROM all_heights a
LEFT JOIN existing_heights e ON a.height = e.height
WHERE e.height IS NULL
ORDER BY a.height;`

	SelectRemainingMcaSnapshotsHeights = `WITH all_heights AS (
  SELECT generate_series(1, $1) AS block_height
),
existing_heights AS (
  SELECT DISTINCT block_height FROM mca_snapshots
)
SELECT a.block_height
FROM all_heights a
LEFT JOIN existing_heights e ON a.block_height = e.block_height
WHERE e.block_height IS NULL
ORDER BY a.block_height;`

	SelectRemainingUtxoHistoryHeights = `WITH all_heights AS (
  SELECT generate_series(1, $1) AS create_height
),
existing_heights AS (
  SELECT DISTINCT create_height FROM utxo_history
)
SELECT a.create_height
FROM all_heights a
LEFT JOIN existing_heights e ON a.create_height = e.create_height
WHERE e.create_height IS NULL
ORDER BY a.create_height;`
)
