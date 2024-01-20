package internal

// These queries relate primarily to the "monthly_price" table.
const (
	CreateMonthlyPriceTable = `CREATE TABLE IF NOT EXISTS monthly_price (
		id SERIAL8 PRIMARY KEY,
		month TIMESTAMPTZ NOT NULL,
		price FLOAT8
	);`

	//insert to address summary table
	InsertMonthlyPriceRow = `INSERT INTO monthly_price (month, price)
		VALUES ($1, $2)`

	//select rows from monthly price
	SelectMonthlyPriceRows = `SELECT * FROM monthly_price ORDER BY month`

	//select last row from monthly price
	SelectLastMonthlyPrice = `SELECT month FROM monthly_price ORDER BY month DESC LIMIT 1`

	//select rows by period of month
	SelectMonthlyPriceRowsByPeriod = `SELECT month,price FROM monthly_price WHERE EXTRACT(EPOCH FROM month) >= $1 AND EXTRACT(EPOCH FROM month) <= $2 ORDER BY month`

	//check exist month
	CheckExistMonth = `SELECT EXISTS(SELECT 1 FROM monthly_price WHERE EXTRACT(YEAR FROM month) = $1 AND EXTRACT(MONTH FROM month) = $2)`
)
