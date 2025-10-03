// Copyright (c) 2019-2021, The Decred developers
// See LICENSE for details.

package cache

import (
	"context"
	"database/sql"
	"encoding/gob"
	"fmt"
	"os"
	"sync"
	"time"

	btcchaincfg "github.com/btcsuite/btcd/chaincfg"
	ltcchaincfg "github.com/ltcsuite/ltcd/chaincfg"

	"github.com/decred/dcrdata/v8/mutilchain"
	"github.com/decred/dcrdata/v8/txhelpers"
	"github.com/decred/dcrdata/v8/xmr/xmrclient"
)

type ChartMutilchainUpdater struct {
	Tag string
	// In addition to the sql.Rows and an error, the fetcher should return a
	// context.CancelFunc if appropriate, else a dummy.
	Fetcher func(*MutilchainChartData) (*sql.Rows, func(), error)
	// The Appender will be run under mutex lock.
	Appender func(*MutilchainChartData, *sql.Rows) error
}

type MutilchainChartData struct {
	mtx                 sync.RWMutex
	ctx                 context.Context
	LastBlockHeight     int64
	Blocks              *ZoomSet
	Days                *ZoomSet
	APIBlockSize        *ZoomSet
	APIBlockchainSize   *ZoomSet
	APITxNumPerBlockAvg *ZoomSet
	APINewMinedBlocks   *ZoomSet
	APITxTotal          *ZoomSet
	APIMempoolTxCount   *ZoomSet
	APIMempoolSize      *ZoomSet
	APITxFeeAvg         *ZoomSet
	APICoinSupply       *ZoomSet
	APIHashrate         *ZoomSet
	APIDifficulty       *ZoomSet
	APIAddressCount     *ZoomSet
	cacheMtx            sync.RWMutex
	cache               map[string]*cachedChart
	updateMtx           sync.Mutex
	updaters            []ChartMutilchainUpdater
	TimePerBlocks       float64
	ChainType           string
	UseSyncDB           bool
	UseAPI              bool
	LastUpdatedTime     time.Time
}

// Lengthen performs data validation and populates the Days zoomSet. If there is
// an update to a zoomSet or windowSet, the cacheID will be incremented.
func (charts *MutilchainChartData) Lengthen() error {
	charts.mtx.Lock()
	defer charts.mtx.Unlock()

	// Make sure the database has set an equal number of blocks in each data set.
	blocks := charts.Blocks
	var shortest int
	var err error
	if charts.ChainType == mutilchain.TYPEXMR {
		shortest, err = ValidateLengths(blocks.Height, blocks.Time,
			blocks.BlockSize, blocks.TotalSize, blocks.TxCount, blocks.Fees, blocks.Difficulty,
			blocks.Hashrate, blocks.Reward)
		// blocks.Hashrate, blocks.Reward, blocks.TotalRingSize, blocks.AverageRingSize)
	} else {
		shortest, err = ValidateLengths(blocks.Height, blocks.Time,
			blocks.BlockSize, blocks.TxCount, blocks.Fees, blocks.Difficulty,
			blocks.Hashrate, blocks.Reward)
	}
	if err != nil {
		log.Warnf("%s: MultiChartData.Lengthen: multichain block data length mismatch detected. "+
			"Truncating blocks length to %d", charts.ChainType, shortest)
		blocks.Snip(shortest)
	}
	if shortest == 0 {
		// No blocks yet. Not an error.
		return nil
	}

	days := charts.Days

	// Get the current first and last midnight stamps.
	end := midnight(blocks.Time[len(blocks.Time)-1])
	var start uint64
	if len(days.Time) > 0 {
		// Begin the scan at the beginning of the next day. The stamps in the Time
		// set are the midnight that starts the day.
		start = days.Time[len(days.Time)-1] + aDay
	} else {
		// Start from the beginning.
		// Already checked for empty blocks above.
		start = midnight(blocks.Time[0])
	}

	// Find the index that begins new data.
	offset := 0
	for i, t := range blocks.Time {
		if t > start {
			offset = i
			break
		}
	}

	intervals := [][2]int{}
	// If there is day or more worth of new data, append to the Days zoomSet by
	// finding the first and last+1 blocks of each new day, and taking averages
	// or sums of the blocks in the interval.
	if end > start+aDay {
		next := start + aDay
		startIdx := 0
		for i, t := range blocks.Time[offset:] {
			if t >= next {
				// Once passed the next midnight, prepare a day window by storing the
				// range of indices.
				intervals = append(intervals, [2]int{startIdx + offset, i + offset})
				days.Time = append(days.Time, start)
				start = next
				next += aDay
				startIdx = i
				if t > end {
					break
				}
			}
		}

		for _, interval := range intervals {
			// For each new day, take an appropriate snapshot. Some sets use sums,
			// some use averages, and some use the last value of the day.
			days.Height = append(days.Height, uint64(interval[1]-1))
			days.BlockSize = append(days.BlockSize, blocks.BlockSize.Sum(interval[0], interval[1]))
			if charts.ChainType == mutilchain.TYPEXMR {
				days.TotalSize = append(days.TotalSize, blocks.TotalSize.Sum(interval[0], interval[1]))
				// days.TotalRingSize = append(days.TotalRingSize, blocks.TotalRingSize.Sum(interval[0], interval[1]))
				// days.AverageRingSize = append(days.AverageRingSize, blocks.AverageRingSize.Avg(interval[0], interval[1]))
			}
			days.TxCount = append(days.TxCount, blocks.TxCount.Sum(interval[0], interval[1]))
			days.Reward = append(days.Reward, blocks.Reward.Sum(interval[0], interval[1]))
			days.Fees = append(days.Fees, blocks.Fees.Sum(interval[0], interval[1]))
			days.Difficulty = append(days.Difficulty, blocks.Difficulty.Avg(interval[0], interval[1]))
			days.Hashrate = append(days.Hashrate, blocks.Hashrate.Avg(interval[0], interval[1]))
		}
	}

	// Check that all relevant datasets have been updated to the same length.
	var daysLen int
	if charts.ChainType == mutilchain.TYPEXMR {
		daysLen, err = ValidateLengths(days.Height, days.Time,
			days.BlockSize, days.TotalSize, days.TxCount, days.Reward, days.Fees, days.Difficulty, days.Hashrate)
		// days.BlockSize, days.TotalSize, days.TxCount, days.Reward, days.Fees, days.Difficulty, days.Hashrate, days.TotalRingSize, days.AverageRingSize)
	} else {
		daysLen, err = ValidateLengths(days.Height, days.Time,
			days.BlockSize, days.TxCount, days.Reward, days.Fees, days.Difficulty, days.Hashrate)
	}

	if err != nil {
		return fmt.Errorf("day bin: %v", err)
	} else if daysLen == 0 {
		log.Warnf("%s: (*ChartData).Lengthen: Zero-length day-binned data!", charts.ChainType)
	}

	charts.cacheMtx.Lock()
	defer charts.cacheMtx.Unlock()
	// The cacheID for day-binned data, only increment the cacheID when entries
	// were added.
	if len(intervals) > 0 {
		days.cacheID++
	}
	// For blocks and windows, the cacheID is the last timestamp.
	charts.Blocks.cacheID = blocks.Time[len(blocks.Time)-1]
	return nil
}

// ReorgHandler handles the charts cache data reorganization. ReorgHandler
// satisfies notification.ReorgHandler, and is registered as a handler in
// main.go.
func (charts *MutilchainChartData) ReorgHandler(reorg *txhelpers.ReorgData) error {
	commonAncestorHeight := int(reorg.NewChainHeight) - len(reorg.NewChain)
	charts.mtx.Lock()
	newHeight := commonAncestorHeight + 1
	log.Debugf("ChartData.ReorgHandler snipping blocks height to %d", newHeight)
	charts.Blocks.Snip(newHeight)
	// Snip the last two days
	daysLen := len(charts.Days.Time)
	daysLen -= 2
	log.Debugf("ChartData.ReorgHandler snipping days height to %d", daysLen)
	charts.Days.Snip(daysLen)
	charts.mtx.Unlock()
	return nil
}

// writeCacheFile creates the charts cache in the provided file path if it
// doesn't exists. It dumps the ChartsData contents using the .gob encoding.
// Drops the old .gob dump before creating a new one. Delete the old cache here
// rather than after loading so that a dump will still be available after a crash.
func (charts *MutilchainChartData) writeCacheFile(filePath string) error {
	if isFileExists(filePath) {
		// delete the old dump files before creating new ones.
		os.RemoveAll(filePath)
	}

	file, err := os.Create(filePath)
	if err != nil {
		return err
	}

	defer file.Close()

	encoder := gob.NewEncoder(file)
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return encoder.Encode(versionedCacheData{cacheVersion.String(), charts.gobject()})
}

// readCacheFile reads the contents of the charts cache dump file encoded in
// .gob format if it exists returns an error if otherwise.
func (charts *MutilchainChartData) readCacheFile(filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}

	defer func() {
		file.Close()
	}()

	var data = new(versionedCacheData)
	decoder := gob.NewDecoder(file)
	err = decoder.Decode(&data)
	if err != nil {
		return err
	}

	// If the required cache version was not found in the .gob file return an error.
	if data.Version != cacheVersion.String() {
		return fmt.Errorf("expected cache version v%s but found v%s",
			cacheVersion, data.Version)
	}

	gobject := data.Data

	charts.mtx.Lock()
	charts.Blocks.Height = gobject.Height
	charts.Blocks.Time = gobject.Time
	charts.Blocks.BlockSize = gobject.BlockSize
	charts.Blocks.TxCount = gobject.TxCount
	charts.Blocks.Reward = gobject.Reward
	charts.Blocks.Fees = gobject.Fees
	charts.Blocks.Difficulty = gobject.PowDiff
	charts.Blocks.Hashrate = gobject.Hashrate
	if charts.ChainType == mutilchain.TYPEXMR {
		// charts.Blocks.TotalRingSize = gobject.TotalRingSize
		// charts.Blocks.AverageRingSize = gobject.AverageRingSize
		charts.Blocks.TotalSize = gobject.TotalSize
	}

	charts.mtx.Unlock()

	err = charts.Lengthen()
	if err != nil {
		log.Warnf("problem detected during (*ChartData).Lengthen. clearing datasets: %v", err)
		charts.Blocks.Snip(0)
		charts.Days.Snip(0)
	}

	return nil
}

// Load loads chart data from the gob file at the specified path and performs an
// update.
func (charts *MutilchainChartData) Load(cacheDumpPath string) error {
	t := time.Now()
	defer func() {
		log.Debugf("Completed the initial chart load and update in %f s",
			time.Since(t).Seconds())
	}()

	if err := charts.readCacheFile(cacheDumpPath); err != nil {
		log.Debugf("Cache dump data loading failed: %v", err)
		// Do not return non-nil error since a new cache file will be generated.
		// Also, return only after Update has restored the charts data.
	}

	// Bring the charts up to date.
	log.Infof("%s: Updating multicharts data...", charts.ChainType)
	return charts.Update()
}

// Dump dumps a ChartGobject to a gob file at the given path.
func (charts *MutilchainChartData) Dump(dumpPath string) {
	err := charts.writeCacheFile(dumpPath)
	if err != nil {
		log.Errorf("ChartData.writeCacheFile failed: %v", err)
	} else {
		log.Debug("Dumping the charts cache data was successful")
	}
}

// TriggerUpdate triggers (*ChartData).Update.
func (charts *MutilchainChartData) TriggerUpdate(_ string, _ uint32) error {
	// Check the sync interval between 2 times. If less than 1 day, ignore
	now := time.Now()
	// Get 1 day before
	oneDayBefore := now.AddDate(0, 0, -1)
	if charts.LastUpdatedTime.After(oneDayBefore) {
		return nil
	}
	if err := charts.Update(); err != nil {
		// Only log errors from ChartsData.Update. TODO: make this more severe.
		log.Errorf("(*ChartData).Update failed: %v", err)
	}
	return nil
}

func (charts *MutilchainChartData) gobject() *ChartGobject {
	return &ChartGobject{
		Height:          charts.Blocks.Height,
		Time:            charts.Blocks.Time,
		BlockSize:       charts.Blocks.BlockSize,
		TotalSize:       charts.Blocks.TotalSize,
		TxCount:         charts.Blocks.TxCount,
		Reward:          charts.Blocks.Reward,
		Fees:            charts.Blocks.Fees,
		PowDiff:         charts.Blocks.Difficulty,
		Hashrate:        charts.Blocks.Hashrate,
		TotalRingSize:   charts.Blocks.TotalRingSize,
		AverageRingSize: charts.Blocks.AverageRingSize,
	}
}

// StateID returns a unique (enough) ID associated with the state of the Blocks
// data in a thread-safe way.
func (charts *MutilchainChartData) StateID() uint64 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return charts.stateID()
}

// stateID returns a unique (enough) ID associated with the state of the Blocks
// data.
func (charts *MutilchainChartData) stateID() uint64 {
	timeLen := len(charts.Blocks.Time)
	if timeLen > 0 {
		return charts.Blocks.Time[timeLen-1]
	}
	return 0
}

// ValidState checks whether the provided chartID is still valid. ValidState
// should be used under at least a (*ChartData).RLock.
func (charts *MutilchainChartData) validState(stateID uint64) bool {
	return charts.stateID() == stateID
}

// Height is the height of the blocks data. Data is assumed to be complete and
// without extraneous entries, which means that the (zoomSet).Height does not
// need to be populated for (ChartData).Blocks because the height is just
// len(Blocks.*)-1.
func (charts *MutilchainChartData) Height() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.Height)) - 1
}

func (charts *MutilchainChartData) RingMembers() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.TotalRingSize)) - 1
}

// FeesTip is the height of the Fees data.
func (charts *MutilchainChartData) FeesTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.Fees)) - 1
}

// TotalMixedTip is the height of the CoinJoin Total Mixed data
func (charts *MutilchainChartData) TotalMixedTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.TotalMixed)) - 1
}

// NewAtomsTip is the height of the NewAtoms data.
func (charts *MutilchainChartData) NewAtomsTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.NewAtoms)) - 1
}

// PoolSizeTip is the height of the PoolSize data.
func (charts *MutilchainChartData) PoolSizeTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.PoolSize)) - 1
}

// AddUpdater adds a ChartUpdater to the Updaters slice. Updaters are run
// sequentially during (*ChartData).Update.
func (charts *MutilchainChartData) AddUpdater(updater ChartMutilchainUpdater) {
	charts.updateMtx.Lock()
	charts.updaters = append(charts.updaters, updater)
	charts.updateMtx.Unlock()
}

// Update refreshes chart data by calling the ChartUpdaters sequentially. The
// Update is abandoned with a warning if stateID changes while running a Fetcher
// (likely due to a new update starting during a query).
func (charts *MutilchainChartData) Update() error {
	// Block simultaneous updates.
	charts.updateMtx.Lock()
	defer charts.updateMtx.Unlock()

	t := time.Now()
	log.Debugf("Running charts updaters for data at height %d...", charts.Height())

	for _, updater := range charts.updaters {
		ti := time.Now()
		stateID := charts.StateID()
		// The Appender checks rows.Err
		// nolint:rowserrcheck
		rows, cancel, err := updater.Fetcher(charts)
		if err != nil {
			err = fmt.Errorf("error encountered during charts %s update. aborting update: %v", updater.Tag, err)
		} else {
			charts.mtx.Lock()
			if !charts.validState(stateID) {
				err = fmt.Errorf("state change detected during charts %s update. aborting update", updater.Tag)
			} else {
				err = updater.Appender(charts, rows)
				if err != nil {
					err = fmt.Errorf("error detected during charts %s append. aborting update: %v", updater.Tag, err)
				}
			}
			charts.mtx.Unlock()
		}
		cancel()
		if err != nil {
			return err
		}
		log.Tracef(" - Chart updater %q completed in %f seconds.",
			updater.Tag, time.Since(ti).Seconds())
	}
	log.Debugf("Charts updaters complete at height %d in %f seconds.",
		charts.Height(), time.Since(t).Seconds())
	charts.LastUpdatedTime = time.Now()
	// Since the charts db data query is complete. Update chart.Days derived dataset.
	if err := charts.Lengthen(); err != nil {
		return fmt.Errorf("(*ChartData).Lengthen failed: %v", err)
	}
	return nil
}

func NewLTCChartData(ctx context.Context, height uint32, chainParams *ltcchaincfg.Params, lastBlockHeight int64, disabledDBSync bool) *MutilchainChartData {
	genesis := chainParams.GenesisBlock.Header.Timestamp
	size := int(height * 5 / 4)
	days := int(time.Since(genesis)/time.Hour/24)*5/4 + 1 // at least one day

	return &MutilchainChartData{
		ctx:             ctx,
		Blocks:          newBlockSet(size),
		Days:            newDaySet(days),
		cache:           make(map[string]*cachedChart),
		updaters:        make([]ChartMutilchainUpdater, 0),
		TimePerBlocks:   float64(chainParams.TargetTimePerBlock),
		ChainType:       mutilchain.TYPELTC,
		LastBlockHeight: lastBlockHeight,
		UseSyncDB:       !disabledDBSync,
	}
}

func NewBTCChartData(ctx context.Context, height uint32, chainParams *btcchaincfg.Params, lastBlockHeight int64, disabledDBSync bool) *MutilchainChartData {
	genesis := chainParams.GenesisBlock.Header.Timestamp
	size := int(height * 5 / 4)
	days := int(time.Since(genesis)/time.Hour/24)*5/4 + 1 // at least one day

	return &MutilchainChartData{
		ctx:             ctx,
		Blocks:          newBlockSet(size),
		Days:            newDaySet(days),
		cache:           make(map[string]*cachedChart),
		updaters:        make([]ChartMutilchainUpdater, 0),
		TimePerBlocks:   float64(chainParams.TargetTimePerBlock),
		ChainType:       mutilchain.TYPEBTC,
		LastBlockHeight: lastBlockHeight,
		UseSyncDB:       !disabledDBSync,
	}
}

func NewXMRChartData(ctx context.Context, xmrClient *xmrclient.XMRClient, height uint32, lastBlockHeight int64) *MutilchainChartData {
	genesisBl, err := xmrClient.GetBlockHeaderByHeight(uint64(1))
	if err != nil {
		log.Errorf("XMR: Get genesis block failed: %v", err)
		return nil
	}
	info, err := xmrClient.GetInfo()
	if err != nil {
		log.Errorf("XMR: Get blockchain info failed: %v", err)
		return nil
	}
	size := int(height * 5 / 4)
	days := int(time.Since(time.Unix(int64(genesisBl.Timestamp), 0))/time.Hour/24)*5/4 + 1 // at least one day

	return &MutilchainChartData{
		ctx:             ctx,
		Blocks:          newBlockSet(size),
		Days:            newDaySet(days),
		cache:           make(map[string]*cachedChart),
		updaters:        make([]ChartMutilchainUpdater, 0),
		TimePerBlocks:   float64(info.Target),
		ChainType:       mutilchain.TYPEXMR,
		LastBlockHeight: lastBlockHeight,
		// UseSyncDB:       !disabledDBSync,
	}
}

// Grabs the cacheID associated with the provided BinLevel. Should
// be called under at least a (ChartData).cacheMtx.RLock.
func (charts *MutilchainChartData) cacheID(bin binLevel) uint64 {
	switch bin {
	case BlockBin:
		return charts.Blocks.cacheID
	case DayBin:
		return charts.Days.cacheID
	}
	return 0
}

// Grab the cached data, if it exists. The cacheID is returned as a convenience.
func (charts *MutilchainChartData) getCache(chartID string, bin binLevel, axis axisType) (data *cachedChart, found bool, cacheID uint64) {
	// Ignore zero length since bestHeight would just be set to zero anyway.
	ck := cacheKey(chartID, bin, axis, "")
	charts.cacheMtx.RLock()
	defer charts.cacheMtx.RUnlock()
	cacheID = charts.cacheID(bin)
	data, found = charts.cache[ck]
	return
}

// Store the chart associated with the provided type and BinLevel.
func (charts *MutilchainChartData) cacheChart(chartID string, bin binLevel, axis axisType, data []byte) {
	ck := cacheKey(chartID, bin, axis, "")
	charts.cacheMtx.Lock()
	defer charts.cacheMtx.Unlock()
	// Using the current best cacheID. This leaves open the small possibility that
	// the cacheID is wrong, if the cacheID has been updated between the
	// ChartMaker and here. This would just cause a one block delay.
	charts.cache[ck] = &cachedChart{
		cacheID: charts.cacheID(bin),
		data:    data,
	}
}

// ChartMaker is a function that accepts a chart type and BinLevel, and returns
// a JSON-encoded chartResponse.
type MutilchainChartMaker func(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error)

var mutilchainChartMaker = map[string]MutilchainChartMaker{
	BlockSize:      MutilchainBlockSizeChart,
	BlockChainSize: MutilchainBlockchainSizeChart,
	CoinSupply:     MutilchainCoinSupplyChart,
	DurationBTW:    MutilchainDurationBTWChart,
	HashRate:       MutilchainHashRateChart,
	POWDifficulty:  MutilchainDifficultyChart,
	TxCount:        MutilchainTxCountChart,
	Fees:           MutilchainFeesChart,
	TxNumPerBlock:  MutilchainTxNumPerBlock,
	MinedBlocks:    MutilchainMinedBlocks,
	MempoolTxCount: MutilchainMempoolTxCount,
	MempoolSize:    MutilchainMempoolSize,
	AddressNumber:  MutilchainAddressNumber,
}

var xmrChartMaker = map[string]MutilchainChartMaker{
	BlockSize:      xmrBlockSizeChart,
	BlockChainSize: xmrBlockchainSizeChart,
	CoinSupply:     xmrCoinSupplyChart,
	DurationBTW:    xmrDurationBTWChart,
	HashRate:       xmrHashrateChart,
	POWDifficulty:  xmrDifficultyChart,
	TxCount:        xmrTxCountChart,
	Fees:           xmrFeesChart,
	TxNumPerBlock:  xmrTxsPerBlockChart,
	TotalRingSize:  xmrRingSizeSum,
	AvgRingSize:    xmrRingSizeAvg,
}

// Chart will return a JSON-encoded chartResponse of the provided chart,
// binLevel, and axis (TimeAxis, HeightAxis). binString is ignored for
// window-binned charts.
func (charts *MutilchainChartData) Chart(chartID, binString, axisString string) ([]byte, error) {
	bin := ParseBin(binString)
	axis := ParseAxis(axisString)
	cache, found, cacheID := charts.getCache(chartID, bin, axis)
	if found && cache.cacheID == cacheID {
		return cache.data, nil
	}
	var maker MutilchainChartMaker
	var hasMaker bool
	if charts.ChainType == mutilchain.TYPEXMR {
		maker, hasMaker = xmrChartMaker[chartID]
	} else {
		maker, hasMaker = mutilchainChartMaker[chartID]
	}
	if !hasMaker {
		return nil, UnknownChartErr
	}
	// Do the locking here, rather than in encode, so that the helper functions
	// (accumulate, btw) are run under lock.
	charts.mtx.RLock()
	data, err := maker(charts, bin, axis)
	charts.mtx.RUnlock()
	if err != nil {
		return nil, err
	}
	charts.cacheChart(chartID, bin, axis, data)
	return data, nil
}

func xmrCoinSupplyChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				supplyKey: accumulateFloat(charts.Blocks.Reward),
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:   charts.Blocks.Time,
				supplyKey: accumulateFloat(charts.Blocks.Reward),
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Reward,
				supplyKey: accumulateFloat(charts.Days.Reward),
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:   charts.Days.Time,
				supplyKey: accumulateFloat(charts.Days.Reward),
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func xmrBlockSizeChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				sizeKey: charts.Blocks.BlockSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				sizeKey: charts.Blocks.BlockSize,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				sizeKey:   charts.Days.BlockSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				sizeKey: charts.Days.BlockSize,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func xmrBlockchainSizeChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				sizeKey: accumulate(charts.Blocks.TotalSize),
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				sizeKey: accumulate(charts.Blocks.TotalSize),
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				sizeKey:   accumulate(charts.Days.TotalSize),
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				sizeKey: accumulate(charts.Days.TotalSize),
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func xmrRingSizeSum(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				ringSizeKey: charts.Blocks.TotalRingSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:     charts.Blocks.Time,
				ringSizeKey: charts.Blocks.TotalRingSize,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey:   charts.Days.Height,
				ringSizeKey: charts.Days.TotalRingSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:     charts.Days.Time,
				ringSizeKey: charts.Days.TotalRingSize,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func xmrRingSizeAvg(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				ringSizeKey: charts.Blocks.AverageRingSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:     charts.Blocks.Time,
				ringSizeKey: charts.Blocks.AverageRingSize,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey:   charts.Days.Height,
				ringSizeKey: charts.Days.AverageRingSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:     charts.Days.Time,
				ringSizeKey: charts.Days.AverageRingSize,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func xmrFeesChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				feesKey: charts.Blocks.Fees,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				feesKey: charts.Blocks.Fees,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				feesKey:   charts.Days.Fees,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				feesKey: charts.Days.Fees,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func xmrTxCountChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				countKey: accumulate(charts.Blocks.TxCount),
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:  charts.Blocks.Time,
				countKey: accumulate(charts.Blocks.TxCount),
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				countKey:  accumulate(charts.Days.TxCount),
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:  charts.Days.Time,
				countKey: accumulate(charts.Days.TxCount),
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func xmrTxsPerBlockChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				countKey: charts.Blocks.TxCount,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:  charts.Blocks.Time,
				countKey: charts.Blocks.TxCount,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				countKey:  charts.Days.TxCount,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:  charts.Days.Time,
				countKey: charts.Days.TxCount,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func xmrDifficultyChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				diffKey: charts.Blocks.Difficulty,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				diffKey: charts.Blocks.Difficulty,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				diffKey:   charts.Days.Difficulty,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				diffKey: charts.Days.Difficulty,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func xmrHashrateChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				rateKey: charts.Blocks.Hashrate,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				rateKey: charts.Blocks.Hashrate,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				rateKey:   charts.Days.Hashrate,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				rateKey: charts.Days.Hashrate,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func xmrDurationBTWChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			_, diffs := blockTimes(charts.Blocks.Time)
			return encode(lengtherMap{
				durationKey: diffs,
			}, seed)
		default:
			times, diffs := blockTimes(charts.Blocks.Time)
			return encode(lengtherMap{
				timeKey:     times,
				durationKey: diffs,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			if len(charts.Days.Height) < 2 {
				return nil, fmt.Errorf("found the length of charts.Days.Height slice to be less than 2")
			}
			_, diffs := avgBlockTimes(charts.Days.Time, charts.Blocks.Time)
			return encode(lengtherMap{
				heightKey:   charts.Days.Height[:len(charts.Days.Height)-1],
				durationKey: diffs,
			}, seed)
		default:
			times, diffs := avgBlockTimes(charts.Days.Time, charts.Blocks.Time)
			return encode(lengtherMap{
				timeKey:     times,
				durationKey: diffs,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func MutilchainBlockSizeChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				sizeKey: charts.Blocks.BlockSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				sizeKey: charts.Blocks.BlockSize,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				sizeKey:   charts.Days.BlockSize,
			}, seed)
		default:
			if charts.UseAPI {
				timeArray := newChartUints(0)
				blockSizeArray := newChartUints(0)
				if charts.APIBlockSize != nil {
					timeArray = charts.APIBlockSize.Time
					blockSizeArray = charts.APIBlockSize.BlockSize
				}
				return encode(lengtherMap{
					timeKey: timeArray,
					sizeKey: blockSizeArray,
				}, seed)
			}
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				sizeKey: charts.Days.BlockSize,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func MutilchainBlockchainSizeChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				sizeKey: accumulate(charts.Blocks.BlockSize),
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				sizeKey: accumulate(charts.Blocks.BlockSize),
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				sizeKey:   accumulate(charts.Days.BlockSize),
			}, seed)
		default:
			if charts.UseAPI {
				timeArray := newChartUints(0)
				blockchainSizeArray := newChartUints(0)
				if charts.APIBlockchainSize != nil {
					timeArray = charts.APIBlockchainSize.Time
					blockchainSizeArray = charts.APIBlockchainSize.APIBlockchainSize
				}
				return encode(lengtherMap{
					timeKey: timeArray,
					sizeKey: blockchainSizeArray,
				}, seed)
			}
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				sizeKey: accumulate(charts.Days.BlockSize),
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func MutilchainChainWorkChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				workKey: charts.Blocks.Chainwork,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				workKey: charts.Blocks.Chainwork,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				workKey:   charts.Days.Chainwork,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				workKey: charts.Days.Chainwork,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func MutilchainCoinSupplyChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				supplyKey: accumulate(charts.Blocks.NewAtoms),
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:   charts.Blocks.Time,
				supplyKey: accumulate(charts.Blocks.NewAtoms),
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				supplyKey: accumulate(charts.Days.NewAtoms),
			}, seed)
		default:
			if charts.UseAPI {
				timeArray := newChartUints(0)
				coinSupplyArray := newChartUints(0)
				if charts.APICoinSupply != nil {
					timeArray = charts.APICoinSupply.Time
					coinSupplyArray = charts.APICoinSupply.NewAtoms
				}
				return encode(lengtherMap{
					timeKey:   timeArray,
					supplyKey: coinSupplyArray,
				}, seed)
			}
			return encode(lengtherMap{
				timeKey:   charts.Days.Time,
				supplyKey: accumulate(charts.Days.NewAtoms),
				heightKey: charts.Days.Height,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func MutilchainDurationBTWChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			_, diffs := blockTimes(charts.Blocks.Time)
			return encode(lengtherMap{
				durationKey: diffs,
			}, seed)
		default:
			times, diffs := blockTimes(charts.Blocks.Time)
			return encode(lengtherMap{
				timeKey:     times,
				durationKey: diffs,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			if len(charts.Days.Height) < 2 {
				return nil, fmt.Errorf("found the length of charts.Days.Height slice to be less than 2")
			}
			_, diffs := avgBlockTimes(charts.Days.Time, charts.Blocks.Time)
			return encode(lengtherMap{
				heightKey:   charts.Days.Height[:len(charts.Days.Height)-1],
				durationKey: diffs,
			}, seed)
		default:
			times, diffs := avgBlockTimes(charts.Days.Time, charts.Blocks.Time)
			return encode(lengtherMap{
				timeKey:     times,
				durationKey: diffs,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

// func MutilchainHashRateChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
// 	seed := binAxisSeed(bin, axis)
// 	switch bin {
// 	case BlockBin:
// 		if len(charts.Blocks.Time) < 2 {
// 			return nil, fmt.Errorf("Not enough blocks to calculate hashrate")
// 		}
// 		seed[offsetKey] = HashrateAvgLength
// 		times, rates := hashrate(charts.Blocks.Time, charts.Blocks.Chainwork)
// 		switch axis {
// 		case HeightAxis:
// 			return encode(lengtherMap{
// 				rateKey: rates,
// 			}, seed)
// 		default:
// 			return encode(lengtherMap{
// 				timeKey: times,
// 				rateKey: rates,
// 			}, seed)
// 		}
// 	case DayBin:
// 		if len(charts.Days.Time) < 2 {
// 			return nil, fmt.Errorf("Not enough days to calculate hashrate")
// 		}
// 		seed[offsetKey] = 1
// 		times, rates := dailyHashrate(charts.Days.Time, charts.Days.Chainwork)
// 		switch axis {
// 		case HeightAxis:
// 			return encode(lengtherMap{
// 				heightKey: charts.Days.Height[1:],
// 				rateKey:   rates,
// 			}, seed)
// 		default:
// 			return encode(lengtherMap{
// 				timeKey: times,
// 				rateKey: rates,
// 			}, seed)
// 		}
// 	}
// 	return nil, InvalidBinErr
// }

func MutilchainDifficultyChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	// Pow Difficulty only has window level bin, so all others are ignored.
	seed := binAxisSeed(bin, axis)
	switch axis {
	case HeightAxis:
		return encode(lengtherMap{
			diffKey: charts.Blocks.Difficulty,
		}, seed)
	default:
		if charts.UseAPI {
			timeArray := newChartUints(0)
			difficultyArray := newChartFloats(0)
			if charts.APIDifficulty != nil {
				timeArray = charts.APIDifficulty.Time
				difficultyArray = charts.APIDifficulty.Difficulty
			}
			return encode(lengtherMap{
				diffKey: difficultyArray,
				timeKey: timeArray,
			}, seed)
		}
		return encode(lengtherMap{
			diffKey: charts.Blocks.Difficulty,
			timeKey: charts.Blocks.Time,
		}, seed)
	}
}

func MutilchainHashRateChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	// Pow Difficulty only has window level bin, so all others are ignored.
	seed := binAxisSeed(bin, axis)
	switch axis {
	case HeightAxis:
		return encode(lengtherMap{
			heightKey: charts.Days.Height[1:],
			rateKey:   charts.Blocks.Hashrate,
		}, seed)
	default:
		if charts.UseAPI {
			timeArray := newChartUints(0)
			hashrateArray := newChartFloats(0)
			if charts.APIHashrate != nil {
				timeArray = charts.APIHashrate.Time
				hashrateArray = charts.APIHashrate.Hashrate
			}
			return encode(lengtherMap{
				timeKey: timeArray,
				rateKey: hashrateArray,
			}, seed)
		}
		return encode(lengtherMap{
			timeKey: charts.Blocks.Time,
			rateKey: charts.Blocks.Hashrate,
		}, seed)
	}
}

func MutilchainTxCountChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				countKey: charts.Blocks.TxCount,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:  charts.Blocks.Time,
				countKey: charts.Blocks.TxCount,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				countKey:  charts.Days.TxCount,
			}, seed)
		default:
			if charts.UseAPI {
				timeArray := newChartUints(0)
				txcountArray := newChartUints(0)
				if charts.APITxTotal != nil {
					timeArray = charts.APITxTotal.Time
					txcountArray = charts.APITxTotal.TxCount
				}
				return encode(lengtherMap{
					timeKey:  timeArray,
					countKey: txcountArray,
				}, seed)
			}
			return encode(lengtherMap{
				timeKey:  charts.Days.Time,
				countKey: charts.Days.TxCount,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func MutilchainTxNumPerBlock(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	return encode(lengtherMap{
		timeKey:  charts.APITxNumPerBlockAvg.Time,
		countKey: charts.APITxNumPerBlockAvg.APITxAverage,
	}, seed)
}

func MutilchainMinedBlocks(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	return encode(lengtherMap{
		timeKey:  charts.APINewMinedBlocks.Time,
		countKey: charts.APINewMinedBlocks.APIMinedBlocks,
	}, seed)
}

func MutilchainMempoolTxCount(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	return encode(lengtherMap{
		timeKey:  charts.APIMempoolTxCount.Time,
		countKey: charts.APIMempoolTxCount.APIMempoolTxNum,
	}, seed)
}

func MutilchainMempoolSize(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	return encode(lengtherMap{
		timeKey: charts.APIMempoolSize.Time,
		sizeKey: charts.APIMempoolSize.APIMempoolSize,
	}, seed)
}

func MutilchainAddressNumber(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	return encode(lengtherMap{
		timeKey:  charts.APIAddressCount.Time,
		countKey: charts.APIAddressCount.APIAddressCount,
	}, seed)
}

func MutilchainFeesChart(charts *MutilchainChartData, bin binLevel, axis axisType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				feesKey: charts.Blocks.Fees,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				feesKey: charts.Blocks.Fees,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				feesKey:   charts.Days.Fees,
			}, seed)
		default:
			if charts.UseAPI {
				timeArray := newChartUints(0)
				feesArray := newChartUints(0)
				if charts.APITxFeeAvg != nil {
					timeArray = charts.APITxFeeAvg.Time
					feesArray = charts.APITxFeeAvg.Fees
				}
				return encode(lengtherMap{
					timeKey: timeArray,
					feesKey: feesArray,
				}, seed)
			}
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				feesKey: charts.Days.Fees,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}
