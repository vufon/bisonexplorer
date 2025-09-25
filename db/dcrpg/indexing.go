// Copyright (c) 2018-2021, The Decred developers
// See LICENSE for details.

package dcrpg

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/decred/dcrdata/db/dcrpg/v8/internal"
	"github.com/decred/dcrdata/db/dcrpg/v8/internal/mutilchainquery"
	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/decred/dcrdata/v8/mutilchain"
)

// indexingInfo defines a minimalistic structure used to append new indexes
// to be implemented with minimal code duplication.
type indexingInfo struct {
	Msg       string
	IndexFunc func(db *sql.DB) error
}

// deIndexingInfo defines a minimalistic structure used to append new deindexes
// to be implemented with minimal code duplication.
type deIndexingInfo struct {
	DeIndexFunc func(db *sql.DB) error
}

// Vins table indexes

func IndexVinTableOnVins(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexVinTableOnVins)
	return
}

func IndexVinTableOnPrevOuts(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexVinTableOnPrevOuts)
	return
}

func DeindexVinTableOnVins(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexVinTableOnVins)
	return
}

func DeindexVinTableOnPrevOuts(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexVinTableOnPrevOuts)
	return
}

// Transactions table indexes

func IndexTransactionTableOnHashes(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexTransactionTableOnHashes)
	return
}

func DeindexTransactionTableOnHashes(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexTransactionTableOnHashes)
	return
}

func IndexTransactionTableOnBlockIn(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexTransactionTableOnBlockIn)
	return
}

func DeindexTransactionTableOnBlockIn(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexTransactionTableOnBlockIn)
	return
}

func IndexTransactionTableOnBlockHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexTransactionTableOnBlockHeight)
	return
}

func DeindexTransactionTableOnBlockHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexTransactionTableOnBlockHeight)
	return
}

// Blocks table indexes

func IndexBlockTableOnHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexBlockTableOnHash)
	return
}

func IndexBlockTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexBlocksTableOnHeight)
	return
}

func IndexBlockTableOnTime(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexBlocksTableOnTime)
	return
}

func DeindexBlockTableOnHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexBlockTableOnHash)
	return
}

func DeindexBlockTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexBlocksTableOnHeight)
	return
}

func DeindexBlockTableOnTime(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexBlocksTableOnTime)
	return
}

// vouts table indexes

// IndexVoutTableOnTxHashIdx creates the index for the addresses table over
// transaction hash and index.
func IndexVoutTableOnTxHashIdx(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexVoutTableOnTxHashIdx)
	return
}

func DeindexVoutTableOnTxHashIdx(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexVoutTableOnTxHashIdx)
	return
}

func IndexVoutTableOnSpendTxID(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexVoutTableOnSpendTxID)
	return
}

func DeindexVoutTableOnSpendTxID(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexVoutTableOnSpendTxID)
	return
}

// addresses table indexes

// IndexBlockTimeOnTableAddress creates the index for the addresses table over
// block time.
func IndexBlockTimeOnTableAddress(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexBlockTimeOnTableAddress)
	return
}

func DeindexBlockTimeOnTableAddress(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexBlockTimeOnTableAddress)
	return
}

// IndexAddressTableOnMatchingTxHash creates the index for the addresses table
// over matching transaction hash.
func IndexAddressTableOnMatchingTxHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexAddressTableOnMatchingTxHash)
	return
}

func DeindexAddressTableOnMatchingTxHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexAddressTableOnMatchingTxHash)
	return
}

// IndexAddressTableOnAddress creates the index for the addresses table over
// address.
func IndexAddressTableOnAddress(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexAddressTableOnAddress)
	return
}

func DeindexAddressTableOnAddress(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexAddressTableOnAddress)
	return
}

// IndexAddressTableOnVoutID creates the index for the addresses table over
// vout row ID.
func IndexAddressTableOnVoutID(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexAddressTableOnVoutID)
	return
}

func DeindexAddressTableOnVoutID(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexAddressTableOnVoutID)
	return
}

// IndexAddressTableOnTxHash creates the index for the addresses table over
// transaction hash.
func IndexAddressTableOnTxHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexAddressTableOnTxHash)
	return
}

func DeindexAddressTableOnTxHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexAddressTableOnTxHash)
	return
}

// votes table indexes

func IndexVotesTableOnHashes(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexVotesTableOnHashes)
	return
}

func DeindexVotesTableOnHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexVotesTableOnHashes)
	return
}

func IndexVotesTableOnBlockHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexVotesTableOnBlockHash)
	return
}

func DeindexVotesTableOnBlockHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexVotesTableOnBlockHash)
	return
}

func IndexVotesTableOnCandidate(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexVotesTableOnCandidate)
	return
}

func DeindexVotesTableOnCandidate(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexVotesTableOnCandidate)
	return
}

func IndexVotesTableOnVoteVersion(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexVotesTableOnVoteVersion)
	return
}

func DeindexVotesTableOnVoteVersion(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexVotesTableOnVoteVersion)
	return
}

// IndexVotesTableOnHeight improves the speed of "Cumulative Vote Choices" agendas
// chart query.
func IndexVotesTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexVotesTableOnHeight)
	return
}

func DeindexVotesTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexVotesTableOnHeight)
	return
}

// IndexVotesTableOnBlockTime improves the speed of "Vote Choices By Block" agendas
// chart query.
func IndexVotesTableOnBlockTime(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexVotesTableOnBlockTime)
	return
}

func DeindexVotesTableOnBlockTime(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexVotesTableOnBlockTime)
	return
}

// tickets table indexes

func IndexTicketsTableOnHashes(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexTicketsTableOnHashes)
	return
}

func DeindexTicketsTableOnHashes(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexTicketsTableOnHashes)
	return
}

func IndexTicketsTableOnTxDbID(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexTicketsTableOnTxDbID)
	return
}

func DeindexTicketsTableOnTxDbID(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexTicketsTableOnTxDbID)
	return
}

func IndexTicketsTableOnPoolStatus(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexTicketsTableOnPoolStatus)
	return
}

func DeindexTicketsTableOnPoolStatus(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexTicketsTableOnPoolStatus)
	return
}

// missed votes table indexes

func IndexMissesTableOnHashes(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexMissesTableOnHashes)
	return
}

func DeindexMissesTableOnHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexMissesTableOnHashes)
	return
}

// agendas table indexes

func IndexAgendasTableOnAgendaID(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexAgendasTableOnAgendaID)
	return
}

func DeindexAgendasTableOnAgendaID(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexAgendasTableOnAgendaID)
	return
}

// Proposal_meta indexes

func IndexProposalMetaTableOnProposalToken(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexProposalMetaTableOnProposalToken)
	return
}

// Proposal_meta deindex
func DeindexProposalMetaTableOnProposalToken(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexProposalMetaTableOnProposalToken)
	return
}

// agenda votes table indexes
func IndexAgendaVotesTableOnAgendaID(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexAgendaVotesTableOnAgendaID)
	return
}

func DeindexAgendaVotesTableOnAgendaID(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexAgendaVotesTableOnAgendaID)
	return
}

// agenda votes table indexes
func IndexTSpendVotesTable(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexTSpendVotesTable)
	return
}

func DeindexTSpendVotesTable(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexTSpendVotesTable)
	return
}

// IndexTreasuryTableOnTxHash creates the index for the treasury table over
// tx_hash.
func IndexTreasuryTableOnTxHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexTreasuryOnTxHash)
	return
}

// DeindexTreasuryTableOnTxHash drops the index for the treasury table over tx
// hash.
func DeindexTreasuryTableOnTxHash(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexTreasuryOnTxHash)
	return
}

// IndexTreasuryTableOnHeight creates the index for the treasury table over
// block height.
func IndexTreasuryTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexTreasuryOnBlockHeight)
	return
}

// DeindexTreasuryTableOnHeight drops the index for the treasury table over
// block height.
func DeindexTreasuryTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexTreasuryOnBlockHeight)
	return
}

// IndexSwapsTableOnHeight creates the index for the swaps table over spend
// block height.
func IndexSwapsTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexSwapsOnHeight)
	return
}

// IndexBtcSwapsTableOnHeight creates the index for the btc swaps table over spend
// block height.
func IndexBtcSwapsTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexBtcSwapsOnHeight)
	return
}

// IndexLtcSwapsTableOnHeight creates the index for the ltc swaps table over spend
// block height.
func IndexLtcSwapsTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.IndexLtcSwapsOnHeight)
	return
}

// DeindexSwapsTableOnHeight drops the index for the swaps table over spend
// block height.
func DeindexSwapsTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexSwapsOnHeight)
	return
}

func DeindexBtcSwapsTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexBtcSwapsOnHeight)
	return
}

func DeindexLtcSwapsTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexLtcSwapsOnHeight)
	return
}

func IndexMutilchainFunc(db *sql.DB, query string) (err error) {
	_, err = db.Exec(query)
	return
}

// Delete duplicates

func (pgb *ChainDB) DeleteDuplicateVins() (int64, error) {
	return DeleteDuplicateVins(pgb.db)
}

func (pgb *ChainDB) DeleteDuplicateVouts() (int64, error) {
	return DeleteDuplicateVouts(pgb.db)
}

func (pgb *ChainDB) DeleteDuplicateTxns() (int64, error) {
	return DeleteDuplicateTxns(pgb.db)
}

func (pgb *ChainDB) DeleteDuplicateAgendas() (int64, error) {
	return DeleteDuplicateAgendas(pgb.db)
}

func (pgb *ChainDB) DeleteDuplicateAgendaVotes() (int64, error) {
	return DeleteDuplicateAgendaVotes(pgb.db)
}

// Indexes checks

// MissingIndexes lists missing table indexes and their descriptions.
func (pgb *ChainDB) MissingIndexes() (missing, descs []string, err error) {
	indexDescriptions := internal.IndexDescriptions
	for idxName, desc := range indexDescriptions {
		var exists bool
		exists, err = ExistsIndex(pgb.db, idxName)
		if err != nil {
			return
		}
		if !exists {
			missing = append(missing, idxName)
			descs = append(descs, desc)
		}
	}
	return
}

func (pgb *ChainDB) MutilchainMissingIndexes(chainType string) (missing, descs []string, err error) {
	indexDescriptions := internal.GetMutilchainIndexDescriptionsMap(chainType)
	for idxName, desc := range indexDescriptions {
		var exists bool
		exists, err = ExistsIndex(pgb.db, idxName)
		if err != nil {
			return
		}
		if !exists {
			missing = append(missing, idxName)
			descs = append(descs, desc)
		}
	}
	return
}

// MissingAddressIndexes list missing addresses table indexes and their
// descriptions.
func (pgb *ChainDB) MissingAddressIndexes() (missing []string, descs []string, err error) {
	for _, idxName := range internal.AddressesIndexNames {
		var exists bool
		exists, err = ExistsIndex(pgb.db, idxName)
		if err != nil {
			return
		}
		if !exists {
			missing = append(missing, idxName)
			descs = append(descs, pgb.indexDescription(idxName))
		}
	}
	return
}

func (pgb *ChainDB) MissingMutilchainAddressIndexes(chainType string) (missing []string, descs []string, err error) {
	addrIndexNames := internal.GetMutilchainAddressesIndexNames(chainType)
	for _, idxName := range addrIndexNames {
		var exists bool
		exists, err = ExistsIndex(pgb.db, idxName)
		if err != nil {
			return
		}
		if !exists {
			missing = append(missing, idxName)
			descs = append(descs, pgb.indexDescription(idxName))
		}
	}
	return
}

// indexDescription gives the description of the named index.
func (pgb *ChainDB) indexDescription(indexName string) string {
	indexDescriptions := internal.GetIndexDescriptionsMap()
	name, ok := indexDescriptions[indexName]
	if !ok {
		name = "unknown index"
	}
	return name
}

func (pgb *ChainDB) DeindexMutilchainWholeTable(chainType string) error {
	var err error
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexBlockAllTableOnHash(chainType))
	if err != nil {
		return err
	}
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexBlocksAllTableOnHeight(chainType))
	if err != nil {
		return err
	}
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexBlocksAllTableOnTime(chainType))
	if err != nil {
		return err
	}
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexTransactionTableOnBlockHeight(chainType))
	if err != nil {
		return err
	}
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexTransactionTableOnTxHash(chainType))
	if err != nil {
		return err
	}
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexTransactionTableOnHashes(chainType))
	if err != nil {
		return err
	}

	if chainType == mutilchain.TYPEXMR {
		// monero_outputs table
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexMoneroVoutsTableOnTxHashTxIndex)
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexMoneroVoutTableOnGlobalIndex)
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexMoneroVoutTableOnOutPk)
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexMoneroVoutTableOnSpent)
		if err != nil {
			return err
		}

		// monero_key_images
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexMoneroKeyImagesOnKeyImage)
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexMoneroKeyImagesOnBlockHeight)
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexMoneroKeyImagesOnFirstSeenBlHeight)
		if err != nil {
			return err
		}

		// monero_ring_members
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexMoneroRingMembersOnTxHash)
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexMoneroRingMembersOnMemberGlobalIdx)
		if err != nil {
			return err
		}

		// monero_rct_data
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexMoneroRctDataOnTxHash)
		if err != nil {
			return err
		}
	} else {
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnAddrVoutRowIdStmt(chainType))
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnFundingTxStmt(chainType))
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnAddressStmt(chainType))
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnVoutIDStmt(chainType))
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVinAllTableOnPrevOuts(chainType))
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVinAllTableOnVins(chainType))
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVoutAllTableOnTxHash(chainType))
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVoutAllTableOnTxHashIdx(chainType))
		if err != nil {
			return err
		}
	}
	return nil
}

func (pgb *ChainDB) DeindexMutilchainAddressesTable(chainType string) error {
	var err error
	if chainType == mutilchain.TYPEXMR {
		return nil
	} else {
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnAddrVoutRowIdStmt(chainType))
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnFundingTxStmt(chainType))
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnAddressStmt(chainType))
		if err != nil {
			return err
		}
		err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnVoutIDStmt(chainType))
	}
	return err
}

func (pgb *ChainDB) DeindexAllMutilchain(chainType string) error {
	var err error
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexBlockTableOnHash(chainType))
	if err != nil {
		return err
	}
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexBlockAllTableOnHash(chainType))
	// if err != nil {
	// 	return err
	// }
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexBlocksTableOnHeight(chainType))
	if err != nil {
		return err
	}
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexBlocksAllTableOnHeight(chainType))
	// if err != nil {
	// 	return err
	// }
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexBlocksTableOnTime(chainType))
	if err != nil {
		return err
	}
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexBlocksAllTableOnTime(chainType))
	// if err != nil {
	// 	return err
	// }
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexTransactionTableOnBlockHeight(chainType))
	// if err != nil {
	// 	return err
	// }
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexTransactionTableOnBlockIn(chainType))
	// if err != nil {
	// 	return err
	// }
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexTransactionTableOnHashes(chainType))
	// if err != nil {
	// 	return err
	// }
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVinTableOnPrevOuts(chainType))
	if err != nil {
		return err
	}
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVinAllTableOnPrevOuts(chainType))
	// if err != nil {
	// 	return err
	// }
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVinTableOnVins(chainType))
	if err != nil {
		return err
	}
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVinAllTableOnVins(chainType))
	// if err != nil {
	// 	return err
	// }
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVoutTableOnTxHash(chainType))
	if err != nil {
		return err
	}
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVoutAllTableOnTxHash(chainType))
	// if err != nil {
	// 	return err
	// }
	err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVoutTableOnTxHashIdx(chainType))
	if err != nil {
		return err
	}
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.MakeDeindexVoutAllTableOnTxHashIdx(chainType))
	// if err != nil {
	// 	return err
	// }
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnFundingTxStmt(chainType))
	// if err != nil {
	// 	return err
	// }
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnAddressStmt(chainType))
	// if err != nil {
	// 	return err
	// }
	// err = HandlerDeindexFunc(pgb.db, mutilchainquery.DeindexAddressTableOnVoutIDStmt(chainType))
	return nil
}

// DeindexAll drops indexes in most tables.
func (pgb *ChainDB) DeindexAll() error {
	allDeIndexes := []deIndexingInfo{
		// blocks table
		{DeindexBlockTableOnHash},
		{DeindexBlockTableOnHeight},
		{DeindexBlockTableOnTime},

		// transactions table
		{DeindexTransactionTableOnHashes},
		{DeindexTransactionTableOnBlockIn},
		{DeindexTransactionTableOnBlockHeight},

		// vins table
		{DeindexVinTableOnVins},
		{DeindexVinTableOnPrevOuts},

		// vouts table
		{DeindexVoutTableOnTxHashIdx},
		{DeindexVoutTableOnSpendTxID},

		// addresses table
		{DeindexBlockTimeOnTableAddress},
		{DeindexAddressTableOnMatchingTxHash},
		{DeindexAddressTableOnAddress},
		{DeindexAddressTableOnVoutID},
		{DeindexAddressTableOnTxHash},

		// votes table
		{DeindexVotesTableOnCandidate},
		{DeindexVotesTableOnBlockHash},
		{DeindexVotesTableOnHash},
		{DeindexVotesTableOnVoteVersion},
		{DeindexVotesTableOnHeight},
		{DeindexVotesTableOnBlockTime},

		// misses table
		{DeindexMissesTableOnHash},

		// agendas table
		{DeindexAgendasTableOnAgendaID},

		// proposal_meta table
		{DeindexProposalMetaTableOnProposalToken},

		// agenda votes table
		{DeindexAgendaVotesTableOnAgendaID},

		// tspend_votes table
		{DeindexTSpendVotesTable},

		// stats table
		{DeindexStatsTableOnHeight},

		// treasury table
		{DeindexTreasuryTableOnTxHash},
		{DeindexTreasuryTableOnHeight},

		// swaps table
		{DeindexSwapsTableOnHeight},
		{DeindexBtcSwapsTableOnHeight},
		{DeindexLtcSwapsTableOnHeight},
	}

	var err error
	for _, val := range allDeIndexes {
		if err = val.DeIndexFunc(pgb.db); err != nil {
			warnUnlessNotExists(err)
		}
	}

	if err = pgb.DeindexTicketsTable(); err != nil {
		warnUnlessNotExists(err)
		err = nil
	}
	return err
}

func HandlerDeindexFunc(db *sql.DB, query string) error {
	err := IndexMutilchainFunc(db, query)
	if err != nil {
		warnUnlessNotExists(err)
	}
	return err
}

func (pgb *ChainDB) IndexMutilchainWholeTable(chainType string) error {
	var err error
	//index for all mutilchain table
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%sblock_all on hash", chainType), mutilchainquery.MakeIndexBlockAllTableOnHash(chainType)); err != nil {
		return err
	}
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%sblock_all on height", chainType), mutilchainquery.MakeIndexBlocksAllTableOnHeight(chainType)); err != nil {
		return err
	}
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%sblock_all on time", chainType), mutilchainquery.MakeIndexBlocksAllTableOnTime(chainType)); err != nil {
		return err
	}
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%stransactions on block height", chainType), mutilchainquery.MakeIndexTransactionTableOnBlockHeight(chainType)); err != nil {
		return err
	}
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%stransactions on txhash", chainType), mutilchainquery.MakeIndexTransactionTableOnTxHash(chainType)); err != nil {
		return err
	}
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%stransactions on tx/block hashs", chainType), mutilchainquery.MakeIndexTransactionTableOnHashes(chainType)); err != nil {
		return err
	}

	if chainType == mutilchain.TYPEXMR {
		// monero_outputs
		if err = HandlerMultichainIndexFunc(pgb.db, "monero_outputs on txhash", mutilchainquery.IndexMoneroVoutsTableOnTxHashTxIndex); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "monero_outputs on global_index", mutilchainquery.IndexMoneroVoutTableOnGlobalIndex); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "monero_outputs on out_pk", mutilchainquery.IndexMoneroVoutTableOnOutPk); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "monero_outputs on out_pk", mutilchainquery.IndexMoneroVoutTableOnSpent); err != nil {
			return err
		}

		// monero_key_images
		if err = HandlerMultichainIndexFunc(pgb.db, "monero_key_images on key_image", mutilchainquery.IndexMoneroKeyImagesOnKeyImage); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "monero_key_images on spent_block_height", mutilchainquery.IndexMoneroKeyImagesOnBlockHeight); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "monero_key_images on first_seen_block_height", mutilchainquery.IndexMoneroKeyImagesOnFirstSeenBlHeight); err != nil {
			return err
		}

		// monero_ring_members
		if err = HandlerMultichainIndexFunc(pgb.db, "monero_ring_members on tx_hash/tx_input_index", mutilchainquery.IndexMoneroRingMembersOnTxHash); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "monero_ring_members on member_global_index", mutilchainquery.IndexMoneroRingMembersOnMemberGlobalIdx); err != nil {
			return err
		}

		// monero_rct_data
		if err = HandlerMultichainIndexFunc(pgb.db, "monero_rct_data on tx_hash", mutilchainquery.IndexMoneroRctDataOnTxHash); err != nil {
			return err
		}
	} else {
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%saddress on address/vout_row_id", chainType), mutilchainquery.IndexAddressTableOnAddrVoutRowIdStmt(chainType)); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%saddress on funding txStmt", chainType), mutilchainquery.IndexAddressTableOnFundingTxStmt(chainType)); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%saddress on address", chainType), mutilchainquery.IndexAddressTableOnAddressStmt(chainType)); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%saddress on vout ids", chainType), mutilchainquery.IndexAddressTableOnVoutIDStmt(chainType)); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%svin_all on prev outs", chainType), mutilchainquery.MakeIndexVinAllTableOnPrevOuts(chainType)); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%svin_all on vins", chainType), mutilchainquery.MakeIndexVinAllTableOnVins(chainType)); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%svout_all on tx hash", chainType), mutilchainquery.MakeIndexVoutAllTableOnTxHash(chainType)); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%svout_all on tx hash idx", chainType), mutilchainquery.MakeIndexVoutAllTableOnTxHashIdx(chainType)); err != nil {
			return err
		}
	}
	return nil
}

func (pgb *ChainDB) IndexMutilchainAddressesTable(chainType string) error {
	var err error
	if chainType == mutilchain.TYPEXMR {
		if err = HandlerMultichainIndexFunc(pgb.db, "xmraddresses on out_pk", mutilchainquery.IndexXmrAddressTableOnOutPk); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "xmraddresses on amount_known", mutilchainquery.IndexXmrAddressTableOnAmountKnown); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "xmraddresses on vout_row_id", mutilchainquery.IndexXmrAddressTableOnVoutRowId); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "xmraddresses on funding_tx_hash/funding_tx_vout_index", mutilchainquery.IndexXmrAddressTableOnFundingInfo); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "xmraddresses on global_index", mutilchainquery.IndexXmrAddressTableOnGlobalIndex); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "xmraddresses on key_image", mutilchainquery.IndexXmrAddressTableOnKeyImage); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, "xmraddresses on account_index/address_index", mutilchainquery.IndexXmrAddressTableOnAccIdxAddrIdx); err != nil {
			return err
		}
	} else {
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%saddress on address/vout_row_id", chainType), mutilchainquery.IndexAddressTableOnAddrVoutRowIdStmt(chainType)); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%saddress on funding txStmt", chainType), mutilchainquery.IndexAddressTableOnFundingTxStmt(chainType)); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%saddress on address", chainType), mutilchainquery.IndexAddressTableOnAddressStmt(chainType)); err != nil {
			return err
		}
		if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%saddress on vout ids", chainType), mutilchainquery.IndexAddressTableOnVoutIDStmt(chainType)); err != nil {
			return err
		}
	}
	return nil
}

func (pgb *ChainDB) IndexAllMutilchain(chainType string) error {
	var err error
	//index for all mutilchain table
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%sblock on hash", chainType), mutilchainquery.MakeIndexBlockTableOnHash(chainType)); err != nil {
		return err
	}
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%sblock_all on hash", chainType), mutilchainquery.MakeIndexBlockAllTableOnHash(chainType), barLoad); err != nil {
	// 	return err
	// }
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%sblock on height", chainType), mutilchainquery.MakeIndexBlocksTableOnHeight(chainType)); err != nil {
		return err
	}
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%sblock_all on height", chainType), mutilchainquery.MakeIndexBlocksAllTableOnHeight(chainType), barLoad); err != nil {
	// 	return err
	// }
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%sblock on time", chainType), mutilchainquery.MakeIndexBlocksTableOnTime(chainType)); err != nil {
		return err
	}
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%sblock_all on time", chainType), mutilchainquery.MakeIndexBlocksAllTableOnTime(chainType), barLoad); err != nil {
	// 	return err
	// }
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%stransaction on block height", chainType), mutilchainquery.MakeIndexTransactionTableOnBlockHeight(chainType), barLoad); err != nil {
	// 	return err
	// }
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%stransaction on block in", chainType), mutilchainquery.MakeIndexTransactionTableOnBlockIn(chainType), barLoad); err != nil {
	// 	return err
	// }
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%stransaction on block hashs", chainType), mutilchainquery.MakeIndexTransactionTableOnHashes(chainType), barLoad); err != nil {
	// 	return err
	// }
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%svin on prev outs", chainType), mutilchainquery.MakeIndexVinTableOnPrevOuts(chainType)); err != nil {
		return err
	}
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%svin_all on prev outs", chainType), mutilchainquery.MakeIndexVinAllTableOnPrevOuts(chainType), barLoad); err != nil {
	// 	return err
	// }
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%svin on vins", chainType), mutilchainquery.MakeIndexVinTableOnVins(chainType)); err != nil {
		return err
	}
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%svin_all on vins", chainType), mutilchainquery.MakeIndexVinAllTableOnVins(chainType), barLoad); err != nil {
	// 	return err
	// }
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%svout on tx hash", chainType), mutilchainquery.MakeIndexVoutTableOnTxHash(chainType)); err != nil {
		return err
	}
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%svout_all on tx hash", chainType), mutilchainquery.MakeIndexVoutAllTableOnTxHash(chainType), barLoad); err != nil {
	// 	return err
	// }
	if err = HandlerMultichainIndexFunc(pgb.db, fmt.Sprintf("%svout on tx hash idx", chainType), mutilchainquery.MakeIndexVoutTableOnTxHashIdx(chainType)); err != nil {
		return err
	}
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%svout_all on tx hash idx", chainType), mutilchainquery.MakeIndexVoutAllTableOnTxHashIdx(chainType), barLoad); err != nil {
	// 	return err
	// }
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%saddress on funding txStmt", chainType), mutilchainquery.IndexAddressTableOnFundingTxStmt(chainType), barLoad); err != nil {
	// 	return err
	// }
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%saddress on address", chainType), mutilchainquery.IndexAddressTableOnAddressStmt(chainType), barLoad); err != nil {
	// 	return err
	// }
	// if err = HandlerIndexFunc(pgb.db, fmt.Sprintf("%saddress on vout ids", chainType), mutilchainquery.IndexAddressTableOnVoutIDStmt(chainType), barLoad); err != nil {
	// 	return err
	// }
	return nil
}

// IndexAll creates most indexes in the tables. Exceptions: (1) addresses on
// matching_tx_hash (use IndexAddressTable or do it individually) and (2) all
// tickets table indexes (use IndexTicketsTable).
func (pgb *ChainDB) IndexAll(barLoad chan *dbtypes.ProgressBarLoad) error {
	allIndexes := []indexingInfo{
		// blocks table
		{Msg: "blocks table on hash", IndexFunc: IndexBlockTableOnHash},
		{Msg: "blocks table on height", IndexFunc: IndexBlockTableOnHeight},
		{Msg: "blocks table on time", IndexFunc: IndexBlockTableOnTime},

		// transactions table
		{Msg: "transactions table on tx/block hashes", IndexFunc: IndexTransactionTableOnHashes},
		{Msg: "transactions table on block id/idx", IndexFunc: IndexTransactionTableOnBlockIn},
		{Msg: "transactions table on block height", IndexFunc: IndexTransactionTableOnBlockHeight},

		// vins table
		{Msg: "vins table on txin", IndexFunc: IndexVinTableOnVins},
		{Msg: "vins table on prevouts", IndexFunc: IndexVinTableOnPrevOuts},

		// vouts table
		{Msg: "vouts table on tx hash and index", IndexFunc: IndexVoutTableOnTxHashIdx},
		{Msg: "vouts table on spend tx row id", IndexFunc: IndexVoutTableOnSpendTxID},

		// votes table
		{Msg: "votes table on candidate block", IndexFunc: IndexVotesTableOnCandidate},
		{Msg: "votes table on block hash", IndexFunc: IndexVotesTableOnBlockHash},
		{Msg: "votes table on block+tx hash", IndexFunc: IndexVotesTableOnHashes},
		{Msg: "votes table on vote version", IndexFunc: IndexVotesTableOnVoteVersion},
		{Msg: "votes table on height", IndexFunc: IndexVotesTableOnHeight},
		{Msg: "votes table on Block Time", IndexFunc: IndexVotesTableOnBlockTime},

		// tickets table is done separately by IndexTicketsTable

		// misses table
		{Msg: "misses table", IndexFunc: IndexMissesTableOnHashes},

		// agendas table
		{Msg: "agendas table on Agenda ID", IndexFunc: IndexAgendasTableOnAgendaID},

		// proposal_meta table
		{Msg: "proposal_meta table on Proposal Token", IndexFunc: IndexProposalMetaTableOnProposalToken},

		// agenda votes table
		{Msg: "agenda votes table on Agenda ID", IndexFunc: IndexAgendaVotesTableOnAgendaID},
		// tspend_votes table
		{Msg: "treasury spend votes table on tspend_hash + votes_row_id", IndexFunc: IndexTSpendVotesTable},
		// Not indexing the address table on matching_tx_hash here. See
		// IndexAddressTable to create them all.
		{Msg: "addresses table on tx hash", IndexFunc: IndexAddressTableOnTxHash},
		{Msg: "addresses table on block time", IndexFunc: IndexBlockTimeOnTableAddress},
		{Msg: "addresses table on address", IndexFunc: IndexAddressTableOnAddress}, // TODO: remove or redefine this or IndexAddressTableOnVoutID since that includes address too
		{Msg: "addresses table on vout DB ID", IndexFunc: IndexAddressTableOnVoutID},
		//{Msg: "addresses table on matching tx hash", IndexFunc: IndexAddressTableOnMatchingTxHash},

		// stats table
		// {Msg: "stats table on height", IndexFunc: IndexStatsTableOnHeight}, // redundant with UNIQUE constraint in table def

		// treasury table
		{Msg: "treasury on tx hash", IndexFunc: IndexTreasuryTableOnTxHash},
		{Msg: "treasury on block height", IndexFunc: IndexTreasuryTableOnHeight},

		// swaps table
		{Msg: "swaps on spend height", IndexFunc: IndexSwapsTableOnHeight},
		{Msg: "btc swaps on spend height", IndexFunc: IndexBtcSwapsTableOnHeight},
		{Msg: "ltc swaps on spend height", IndexFunc: IndexLtcSwapsTableOnHeight},
	}

	for _, val := range allIndexes {
		logMsg := "Indexing " + val.Msg + "..."
		log.Infof(logMsg)
		if barLoad != nil {
			barLoad <- &dbtypes.ProgressBarLoad{BarID: dbtypes.InitialDBLoad, Subtitle: logMsg}
		}

		if err := val.IndexFunc(pgb.db); err != nil {
			return err
		}
	}
	// Signal task is done
	if barLoad != nil {
		barLoad <- &dbtypes.ProgressBarLoad{BarID: dbtypes.InitialDBLoad, Subtitle: " "}
	}
	return nil
}

func HandlerIndexFunc(db *sql.DB, key string, query string, barLoad chan *dbtypes.ProgressBarLoad) error {
	logMsg := "Indexing " + key + "..."
	log.Infof(logMsg)
	if barLoad != nil {
		barLoad <- &dbtypes.ProgressBarLoad{BarID: dbtypes.InitialDBLoad, Subtitle: logMsg}
	}
	err := IndexMutilchainFunc(db, query)
	return err
}

func HandlerMultichainIndexFunc(db *sql.DB, key string, query string) error {
	logMsg := "Indexing " + key + "..."
	log.Infof(logMsg)
	err := IndexMutilchainFunc(db, query)
	return err
}

// IndexTicketsTable creates indexes in the tickets table on ticket hash,
// ticket pool status and tx DB ID columns.
func (pgb *ChainDB) IndexTicketsTable(barLoad chan *dbtypes.ProgressBarLoad) error {
	ticketsTableIndexes := []indexingInfo{
		{Msg: "ticket hash", IndexFunc: IndexTicketsTableOnHashes},
		{Msg: "ticket pool status", IndexFunc: IndexTicketsTableOnPoolStatus},
		{Msg: "transaction Db ID", IndexFunc: IndexTicketsTableOnTxDbID},
	}

	for _, val := range ticketsTableIndexes {
		logMsg := "Indexing tickets table on " + val.Msg + "..."
		log.Info(logMsg)
		if barLoad != nil {
			barLoad <- &dbtypes.ProgressBarLoad{BarID: dbtypes.AddressesTableSync, Subtitle: logMsg}
		}

		if err := val.IndexFunc(pgb.db); err != nil {
			return err
		}
	}
	// Signal task is done.
	if barLoad != nil {
		barLoad <- &dbtypes.ProgressBarLoad{BarID: dbtypes.AddressesTableSync, Subtitle: " "}
	}
	return nil
}

// DeindexTicketsTable drops indexes in the tickets table on ticket hash,
// ticket pool status and tx DB ID columns.
func (pgb *ChainDB) DeindexTicketsTable() error {
	ticketsTablesDeIndexes := []deIndexingInfo{
		{DeindexTicketsTableOnHashes},
		{DeindexTicketsTableOnPoolStatus},
		{DeindexTicketsTableOnTxDbID},
	}

	var err error
	for _, val := range ticketsTablesDeIndexes {
		if err = val.DeIndexFunc(pgb.db); err != nil {
			warnUnlessNotExists(err)
			err = nil
		}
	}
	return err
}

func errIsNotExist(err error) bool {
	return strings.Contains(err.Error(), "does not exist")
}

func warnUnlessNotExists(err error) {
	if !errIsNotExist(err) {
		log.Warn(err)
	}
}

// ReindexAddressesBlockTime rebuilds the addresses(block_time) index.
func (pgb *ChainDB) ReindexAddressesBlockTime() error {
	log.Infof("Reindexing addresses table on block time...")
	err := DeindexBlockTimeOnTableAddress(pgb.db)
	if err != nil && !errIsNotExist(err) {
		log.Errorf("Failed to drop index addresses index on block_time: %v", err)
		return err
	}
	return IndexBlockTimeOnTableAddress(pgb.db)
}

// IndexAddressTable creates the indexes on the address table on the vout ID,
// block_time, matching_tx_hash and address columns.
func (pgb *ChainDB) IndexAddressTable(barLoad chan *dbtypes.ProgressBarLoad) error {
	addressesTableIndexes := []indexingInfo{
		{Msg: "address", IndexFunc: IndexAddressTableOnAddress},
		{Msg: "matching tx hash", IndexFunc: IndexAddressTableOnMatchingTxHash},
		{Msg: "block time", IndexFunc: IndexBlockTimeOnTableAddress},
		{Msg: "vout Db ID", IndexFunc: IndexAddressTableOnVoutID},
		{Msg: "tx hash", IndexFunc: IndexAddressTableOnTxHash},
	}

	for _, val := range addressesTableIndexes {
		logMsg := "Indexing addresses table on " + val.Msg + "..."
		log.Info(logMsg)
		if barLoad != nil {
			barLoad <- &dbtypes.ProgressBarLoad{BarID: dbtypes.AddressesTableSync, Subtitle: logMsg}
		}

		if err := val.IndexFunc(pgb.db); err != nil {
			return err
		}
	}
	// Signal task is done.
	if barLoad != nil {
		barLoad <- &dbtypes.ProgressBarLoad{BarID: dbtypes.AddressesTableSync, Subtitle: " "}
	}
	return nil
}

// DeindexAddressTable drops the vin ID, block_time, matching_tx_hash
// and address column indexes for the address table.
func (pgb *ChainDB) DeindexAddressTable() error {
	addressesDeindexes := []deIndexingInfo{
		{DeindexAddressTableOnAddress},
		{DeindexAddressTableOnMatchingTxHash},
		{DeindexBlockTimeOnTableAddress},
		{DeindexAddressTableOnVoutID},
		{DeindexAddressTableOnTxHash},
	}

	var err error
	for _, val := range addressesDeindexes {
		if err = val.DeIndexFunc(pgb.db); err != nil {
			warnUnlessNotExists(err)
			err = nil
		}
	}
	return err
}

// DeindexStatsTableOnHeight drops the index for the stats table over height.
func DeindexStatsTableOnHeight(db *sql.DB) (err error) {
	_, err = db.Exec(internal.DeindexStatsOnHeight)
	return
}
