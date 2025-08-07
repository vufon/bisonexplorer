package internal

// These queries relate primarily to the "monthly_price" table.
const (
	CreateMonthlyPriceTable = `CREATE TABLE IF NOT EXISTS monthly_price (
		id SERIAL8 PRIMARY KEY,
		month TIMESTAMPTZ NOT NULL,
		price FLOAT8,
		is_complete BOOLEAN NOT NULL,
		last_updated TIMESTAMPTZ NOT NULL
	);`

	CreateDailyMarketTable = `CREATE TABLE IF NOT EXISTS daily_market (
		id SERIAL8 PRIMARY KEY,
		date INT8,
		volume FLOAT8,
		open  FLOAT8,
		high FLOAT8,
		low FLOAT8,
		close FLOAT8,
		UNIQUE (date)
	);`

	// daily market check date exist
	CheckDailyMarketExistDate = `SELECT EXISTS(SELECT 1 FROM daily_market WHERE date=$1);`

	// upsert to daily_market table
	UpsertDailyMarketRow = `INSERT INTO daily_market (date, volume, open, high, low, close)
							VALUES ($1, $2, $3, $4, $5, $6)
							ON CONFLICT (date) DO UPDATE 
						SET volume = $2, open = $3, high = $4, low = $5, close = $6`

	//insert to address summary table
	InsertMonthlyPriceRow = `INSERT INTO monthly_price (month, price, is_complete, last_updated)
		VALUES ($1, $2, $3, $4)`

	//select rows from monthly price
	SelectMonthlyPriceRows = `SELECT * FROM monthly_price ORDER BY month`

	//select last row from monthly price
	SelectLastMonthlyPrice = `SELECT month,last_updated FROM monthly_price WHERE is_complete = false ORDER BY month DESC LIMIT 1`
	SelectLastMonth        = `SELECT month FROM monthly_price ORDER BY month DESC LIMIT 1`
	//select rows by period of month
	SelectMonthlyPriceRowsByPeriod = `SELECT month,price FROM monthly_price WHERE EXTRACT(EPOCH FROM month AT TIME ZONE 'UTC') >= $1 AND EXTRACT(EPOCH FROM month AT TIME ZONE 'UTC') <= $2 ORDER BY month`

	//check exist month
	CheckExistMonth            = `SELECT EXISTS(SELECT 1 FROM monthly_price WHERE (EXTRACT(YEAR from month AT TIME ZONE 'UTC')*12 + EXTRACT(MONTH from month AT TIME ZONE 'UTC')) = $1)`
	GetMonthlyPriceInfoByMonth = `SELECT is_complete,last_updated FROM monthly_price WHERE (EXTRACT(YEAR from month AT TIME ZONE 'UTC')*12 + EXTRACT(MONTH from month AT TIME ZONE 'UTC')) = $1 LIMIT 1`
	UpdateMonthlyPriceRow      = `UPDATE monthly_price SET price = $1, is_complete = $2, last_updated = $3 WHERE (EXTRACT(YEAR from month AT TIME ZONE 'UTC')*12 + EXTRACT(MONTH from month AT TIME ZONE 'UTC')) = $4`

	SelectDailyMarketPriceAllRows = `SELECT date, close
		FROM daily_market
		WHERE to_timestamp(date)::date >= to_timestamp($1)::date;
	`
)
