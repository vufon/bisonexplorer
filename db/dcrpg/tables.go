// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, The dcrdata developers
// See LICENSE for details.

package dcrpg

import (
	"database/sql"
	"fmt"

	"github.com/decred/dcrdata/db/dcrpg/v8/internal"
	"github.com/decred/dcrdata/db/dcrpg/v8/internal/mutilchainquery"
	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/decred/dcrdata/v8/mutilchain"
)

const TSpentVotesTable = "tspend_votes"
const BtcSwapsTable = "btc_swaps"
const LtcSwapsTable = "ltc_swaps"

var createTableStatements = [][2]string{
	{"meta", internal.CreateMetaTable},
	{"blocks", internal.CreateBlockTable},
	{"transactions", internal.CreateTransactionTable},
	{"vins", internal.CreateVinTable},
	{"vouts", internal.CreateVoutTable},
	{"block_chain", internal.CreateBlockPrevNextTable},
	{"addresses", internal.CreateAddressTable},
	{"address_summary", internal.CreateAddressSummaryTable},
	{"treasury_summary", internal.CreateTreasurySummaryTable},
	{"tickets", internal.CreateTicketsTable},
	{"votes", internal.CreateVotesTable},
	{"misses", internal.CreateMissesTable},
	{"agendas", internal.CreateAgendasTable},
	{"proposal_meta", internal.CreateProposalMetaTable},
	{"agenda_votes", internal.CreateAgendaVotesTable},
	{"testing", internal.CreateTestingTable},
	{"stats", internal.CreateStatsTable},
	{"treasury", internal.CreateTreasuryTable},
	{"swaps", internal.CreateAtomicSwapTable},
	{"btc_swaps", internal.CreateBtcAtomicSwapTable},
	{"ltc_swaps", internal.CreateLtcAtomicSwapTable},
	{"monthly_price", internal.CreateMonthlyPriceTable},
	{"daily_market", internal.CreateDailyMarketTable},
	{"blocks24h", internal.Create24hBlocksTable},
	{"tspend_votes", internal.CreateTSpendVotesTable},
	{"black_list", internal.CreateBlackListTable},
}

func GetCreateDBTables() [][2]string {
	result := make([][2]string, 0)
	result = append(result, createTableStatements...)
	for _, chainType := range dbtypes.MutilchainList {
		result = append(result, [2]string{fmt.Sprintf("%saddresses", chainType), mutilchainquery.CreateAddressTableFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%sblocks", chainType), mutilchainquery.CreateBlockTableFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%sblocks_all", chainType), mutilchainquery.CreateBlockAllTableFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%sblock_chain", chainType), mutilchainquery.CreateBlockPrevNextTableFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%sfees_stat", chainType), mutilchainquery.CreateFeesStatTableTableFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%smempool_history", chainType), mutilchainquery.CreateMempoolHistoryFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%snodes", chainType), mutilchainquery.CreateNodesTableFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%stransactions", chainType), mutilchainquery.CreateTransactionTableFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%svins", chainType), mutilchainquery.CreateVinTableFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%svins_all", chainType), mutilchainquery.CreateVinAllTableFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%svouts", chainType), mutilchainquery.CreateVoutTableFunc(chainType)})
		result = append(result, [2]string{fmt.Sprintf("%svouts_all", chainType), mutilchainquery.CreateVoutAllTableFunc(chainType)})
		if chainType == mutilchain.TYPEXMR {
			result = append(result, [2]string{"monero_outputs", mutilchainquery.CreateMoneroOutputsTable})
			result = append(result, [2]string{"monero_key_images", mutilchainquery.CreateMoneroKeyImagesTable})
			result = append(result, [2]string{"monero_ring_members", mutilchainquery.CreateMoneroRingMembers})
			result = append(result, [2]string{"monero_rct_data", mutilchainquery.CreateMoneroRctData})
		}
	}
	return result
}

func GetMutilchainTables(chainType string) [][2]string {
	result := make([][2]string, 0)
	result = append(result, [2]string{fmt.Sprintf("%saddresses", chainType), mutilchainquery.CreateAddressTableFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%sblocks", chainType), mutilchainquery.CreateBlockTableFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%sblocks_all", chainType), mutilchainquery.CreateBlockAllTableFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%sblock_chain", chainType), mutilchainquery.CreateBlockPrevNextTableFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%sfees_stat", chainType), mutilchainquery.CreateFeesStatTableTableFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%smempool_history", chainType), mutilchainquery.CreateMempoolHistoryFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%snodes", chainType), mutilchainquery.CreateNodesTableFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%stransactions", chainType), mutilchainquery.CreateTransactionTableFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%svins", chainType), mutilchainquery.CreateVinTableFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%svouts", chainType), mutilchainquery.CreateVoutTableFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%svins_all", chainType), mutilchainquery.CreateVinAllTableFunc(chainType)})
	result = append(result, [2]string{fmt.Sprintf("%svouts_all", chainType), mutilchainquery.CreateVoutAllTableFunc(chainType)})
	if chainType == mutilchain.TYPEXMR {
		result = append(result, [2]string{"monero_outputs", mutilchainquery.CreateMoneroOutputsTable})
		result = append(result, [2]string{"monero_key_images", mutilchainquery.CreateMoneroKeyImagesTable})
		result = append(result, [2]string{"monero_ring_members", mutilchainquery.CreateMoneroRingMembers})
		result = append(result, [2]string{"monero_rct_data", mutilchainquery.CreateMoneroRctData})
	}
	return result
}

func GetCreateTypeStatements() map[string]string {
	result := make(map[string]string)
	for _, chainType := range dbtypes.MutilchainList {
		result[fmt.Sprintf("%svin_t", chainType)] = mutilchainquery.CreateVinTypeFunc(chainType)
		result[fmt.Sprintf("%svout_t", chainType)] = mutilchainquery.CreateVoutTypeFunc(chainType)
	}
	return result
}

func GetCreateTypeAllStatements() map[string]string {
	result := make(map[string]string)
	for _, chainType := range dbtypes.MutilchainList {
		result[fmt.Sprintf("%svin_all_t", chainType)] = mutilchainquery.CreateVinAllTypeFunc(chainType)
		result[fmt.Sprintf("%svout_all_t", chainType)] = mutilchainquery.CreateVoutAllTypeFunc(chainType)
	}
	return result
}

func GetMutilchainCreateTypeStatements(chainType string) map[string]string {
	result := make(map[string]string)
	result[fmt.Sprintf("%svin_t", chainType)] = mutilchainquery.CreateVinTypeFunc(chainType)
	result[fmt.Sprintf("%svout_t", chainType)] = mutilchainquery.CreateVoutTypeFunc(chainType)
	return result
}

func GetMutilchainCreateTypeAllStatements(chainType string) map[string]string {
	result := make(map[string]string)
	result[fmt.Sprintf("%svin_all_t", chainType)] = mutilchainquery.CreateVinAllTypeFunc(chainType)
	result[fmt.Sprintf("%svout_all_t", chainType)] = mutilchainquery.CreateVoutAllTypeFunc(chainType)
	return result
}

func createTableMap() map[string]string {
	createTableQueries := GetCreateDBTables()
	m := make(map[string]string, len(createTableQueries))
	for _, pair := range createTableQueries {
		m[pair[0]] = pair[1]
	}
	return m
}

// dropDuplicatesInfo defines a minimalistic structure that can be used to
// append information needed to delete duplicates in a given table.
type dropDuplicatesInfo struct {
	TableName    string
	DropDupsFunc func() (int64, error)
}

// TableExists checks if the specified table exists.
func TableExists(db *sql.DB, tableName string) (bool, error) {
	rows, err := db.Query(`select relname from pg_class where relname = $1`,
		tableName)
	if err != nil {
		return false, err
	}

	defer func() {
		if e := rows.Close(); e != nil {
			log.Errorf("Close of Query failed: %v", e)
		}
	}()
	return rows.Next(), nil
}

func dropTable(db SqlExecutor, tableName string) error {
	_, err := db.Exec(fmt.Sprintf(`DROP TABLE IF EXISTS %s;`, tableName))
	return err
}

// DropTables drops all of the tables internally recognized tables.
func DropTables(db *sql.DB) {
	createTableQueries := GetCreateDBTables()
	lastIndex := len(createTableQueries) - 1
	for i := range createTableQueries {
		pair := createTableQueries[lastIndex-i]
		tableName := pair[0]
		log.Infof("DROPPING the %q table.", tableName)
		if err := dropTable(db, tableName); err != nil {
			log.Errorf("DROP TABLE %q; failed.", tableName)
		}
	}
}

// DropTestingTable drops only the "testing" table.
func DropTestingTable(db SqlExecutor) error {
	_, err := db.Exec(`DROP TABLE IF EXISTS testing;`)
	return err
}

// AnalyzeAllTables performs an ANALYZE on all tables after setting
// default_statistics_target for the transaction.
func AnalyzeAllTables(db *sql.DB, statisticsTarget int) error {
	dbTx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transactions: %v", err)
	}

	_, err = dbTx.Exec(fmt.Sprintf("SET LOCAL default_statistics_target TO %d;", statisticsTarget))
	if err != nil {
		_ = dbTx.Rollback()
		return fmt.Errorf("failed to set default_statistics_target: %v", err)
	}

	_, err = dbTx.Exec(`ANALYZE;`)
	if err != nil {
		_ = dbTx.Rollback()
		return fmt.Errorf("failed to ANALYZE all tables: %v", err)
	}

	return dbTx.Commit()
}

// AnalyzeTable performs an ANALYZE on the specified table after setting
// default_statistics_target for the transaction.
func AnalyzeTable(db *sql.DB, table string, statisticsTarget int) error {
	dbTx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transactions: %v", err)
	}

	_, err = dbTx.Exec(fmt.Sprintf("SET LOCAL default_statistics_target TO %d;", statisticsTarget))
	if err != nil {
		_ = dbTx.Rollback()
		return fmt.Errorf("failed to set default_statistics_target: %v", err)
	}

	_, err = dbTx.Exec(fmt.Sprintf(`ANALYZE %s;`, table))
	if err != nil {
		_ = dbTx.Rollback()
		return fmt.Errorf("failed to ANALYZE all tables: %v", err)
	}

	return dbTx.Commit()
}

func ClearTestingTable(db *sql.DB) error {
	// Clear the scratch table and reset the serial value.
	_, err := db.Exec(`TRUNCATE TABLE testing;`)
	if err == nil {
		_, err = db.Exec(`SELECT setval('testing_id_seq', 1, false);`)
	}
	return err
}

func CreateMutilchainTypes(db *sql.DB, chainType string) error {
	var err error
	createTypeStatements := GetMutilchainCreateTypeStatements(chainType)
	for typeName, createCommand := range createTypeStatements {
		var exists bool
		exists, err = TypeExists(db, typeName)
		if err != nil {
			return err
		}

		if !exists {
			_, err = db.Exec(createCommand)
			if err != nil {
				return err
			}
			_, err = db.Exec(fmt.Sprintf(`COMMENT ON TYPE %s
				IS 'v1';`, typeName))
			if err != nil {
				return err
			}
		} else {
			log.Debugf("Type \"%s\" exist.", typeName)
		}
	}
	return err
}

func CreateTypes(db *sql.DB) error {
	var err error
	createTypeStatements := GetCreateTypeStatements()
	for typeName, createCommand := range createTypeStatements {
		var exists bool
		exists, err = TypeExists(db, typeName)
		if err != nil {
			return err
		}

		if !exists {
			_, err = db.Exec(createCommand)
			if err != nil {
				return err
			}
			_, err = db.Exec(fmt.Sprintf(`COMMENT ON TYPE %s
				IS 'v1';`, typeName))
			if err != nil {
				return err
			}
		} else {
			log.Debugf("Type \"%s\" exist.", typeName)
		}
	}
	return err
}

func TypeExists(db *sql.DB, tableName string) (bool, error) {
	rows, err := db.Query(`select typname from pg_type where typname = $1`,
		tableName)
	if err == nil {
		defer func() {
			if e := rows.Close(); e != nil {
				log.Infof(`Close of Query failed: %v`, e)
			}
		}()
		return rows.Next(), nil
	}
	return false, err
}

// CreateTables creates all tables required by dcrdata if they do not already
// exist.
func CreateTables(db *sql.DB) error {
	// Create all of the data tables.
	for _, pair := range createTableStatements {
		err := createTable(db, pair[0], pair[1])
		if err != nil {
			return err
		}
	}

	return ClearTestingTable(db)
}

func CreateMutilchainTables(db *sql.DB, chainType string) error {
	createMutilchainTableQueries := GetMutilchainTables(chainType)
	// Create all of the data tables.
	for _, pair := range createMutilchainTableQueries {
		err := createTable(db, pair[0], pair[1])
		if err != nil {
			return err
		}
	}

	return ClearTestingTable(db)
}

// CreateTable creates one of the known tables by name.
func CreateTable(db *sql.DB, tableName string) error {
	tableMap := createTableMap()
	createCommand, tableNameFound := tableMap[tableName]
	if !tableNameFound {
		return fmt.Errorf("table name %s unknown", tableName)
	}

	return createTable(db, tableName, createCommand)
}

// createTable creates a table with the given name using the provided SQL
// statement, if it does not already exist.
func createTable(db *sql.DB, tableName, stmt string) error {
	exists, err := TableExists(db, tableName)
	if err != nil {
		return err
	}

	if !exists {
		log.Infof(`Creating the "%s" table.`, tableName)
		_, err = db.Exec(stmt)
		if err != nil {
			return err
		}
	} else {
		log.Tracef(`Table "%s" exists.`, tableName)
	}
	return err
}

// CheckColumnDataType gets the data type of specified table column .
func CheckColumnDataType(db *sql.DB, table, column string) (dataType string, err error) {
	err = db.QueryRow(`SELECT data_type
		FROM information_schema.columns
		WHERE table_name=$1 AND column_name=$2`,
		table, column).Scan(&dataType)
	return
}

// DeleteDuplicates attempts to delete "duplicate" rows in tables
// where unique indexes are to be created.
func (pgb *ChainDB) DeleteDuplicates(barLoad chan *dbtypes.ProgressBarLoad) error {
	allDuplicates := []dropDuplicatesInfo{
		// Remove duplicate vins
		{TableName: "vins", DropDupsFunc: pgb.DeleteDuplicateVins},

		// Remove duplicate vouts
		{TableName: "vouts", DropDupsFunc: pgb.DeleteDuplicateVouts},

		// Remove duplicate transactions
		{TableName: "transactions", DropDupsFunc: pgb.DeleteDuplicateTxns},

		// Remove duplicate agendas
		{TableName: "agendas", DropDupsFunc: pgb.DeleteDuplicateAgendas},

		// Remove duplicate agenda_votes
		{TableName: "agenda_votes", DropDupsFunc: pgb.DeleteDuplicateAgendaVotes},
	}

	var err error
	for _, val := range allDuplicates {
		msg := fmt.Sprintf("Finding and removing duplicate %s entries...", val.TableName)
		if barLoad != nil {
			barLoad <- &dbtypes.ProgressBarLoad{BarID: dbtypes.InitialDBLoad, Subtitle: msg}
		}
		log.Info(msg)

		var numRemoved int64
		if numRemoved, err = val.DropDupsFunc(); err != nil {
			return fmt.Errorf("delete %s duplicate failed: %v", val.TableName, err)
		}

		msg = fmt.Sprintf("Removed %d duplicate %s entries.", numRemoved, val.TableName)
		if barLoad != nil {
			barLoad <- &dbtypes.ProgressBarLoad{BarID: dbtypes.InitialDBLoad, Subtitle: msg}
		}
		log.Info(msg)
	}
	// Signal task is done
	if barLoad != nil {
		barLoad <- &dbtypes.ProgressBarLoad{BarID: dbtypes.InitialDBLoad, Subtitle: " "}
	}
	return nil
}
