package internal

const (
	CreateCoinAgeTable = `CREATE TABLE IF NOT EXISTS coin_age (
		height INT8,
		time TIMESTAMPTZ,
		coin_days_destroyed FLOAT8,
		avg_coin_days FLOAT8
	);`

	CreateCoinAgeBandsTable = `CREATE TABLE IF NOT EXISTS coin_age_bands (
		height INT8,
		time TIMESTAMPTZ,
		age_band TEXT,
		value INT8
	);`

	SelectCoinAgeMaxHeight      = `SELECT COALESCE(MAX(height), 0) FROM coin_age`
	SelectCoinAgeBandsMaxHeight = `SELECT COALESCE(MAX(height), 0) FROM coin_age_bands`

	SelectCoinAgeAllRows      = `SELECT * FROM coin_age WHERE height > $1 ORDER BY height`
	SelectCoinAgeBandsAllRows = `SELECT * FROM coin_age_bands WHERE height > $1 ORDER BY height`

	InsertCoinAgeRow      = `INSERT INTO coin_age (height, time, coin_days_destroyed, avg_coin_days) VALUES ($1, $2, $3, $4)`
	InsertCoinAgeBandsRow = `INSERT INTO coin_age_bands (height, time, age_band, value) VALUES ($1, $2, $3, $4)`
)
