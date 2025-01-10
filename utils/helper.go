package utils

import (
	"encoding/csv"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func ReadCsvFileFromUrl(filePath string) [][]string {
	resp, err := http.Get(filePath)
	if err != nil {
		log.Fatal("Unable to read input file "+filePath, err)
	}
	defer resp.Body.Close()
	csvReader := csv.NewReader(resp.Body)
	records, err := csvReader.ReadAll()
	if err != nil {
		log.Fatal("Unable to parse file as CSV for "+filePath, err)
	}
	return records
}

func SumVolOfBwRow(row []string) float64 {
	sum := float64(0)
	for index, value := range row {
		if index == 0 {
			continue
		}
		floatValue, err := strconv.ParseFloat(value, 64)
		if err == nil {
			sum += floatValue
		}
	}
	return sum
}

func SumVolOfTimeRange(start time.Time, end time.Time, records [][]string) float64 {
	volSum := float64(0)
	startCal := false
	for i := len(records) - 1; i >= 0; i-- {
		record := records[i]
		dateRec, err := time.Parse("2006-01-02", record[0])
		if err != nil {
			continue
		}
		// if dateRec in range of date
		if ((start.Year() == dateRec.Year() && start.Month() == dateRec.Month() && start.Day() == dateRec.Day()) || dateRec.After(start)) &&
			((end.Year() == dateRec.Year() && end.Month() == dateRec.Month() && end.Day() == dateRec.Day()) || end.After(dateRec)) {
			if !startCal {
				startCal = true
			}
			volSum += SumVolOfBwRow(record)
		} else if startCal {
			break
		}
	}
	return volSum
}

func GroupByWeeklyData(records [][]string) [][]string {
	res := make([][]string, 0)
	curWeekData := make([]string, 0)
	curWeekDataNum := make([]float64, 0)
	var lastTime time.Time
	for _, record := range records {
		dateRec, err := time.Parse("2006-01-02", record[0])
		if err != nil {
			continue
		}
		weekDayNum := int(dateRec.Weekday())
		if len(curWeekDataNum) == 0 {
			for i := int(1); i < len(record); i++ {
				recordFloat, _ := strconv.ParseFloat(record[i], 64)
				curWeekDataNum = append(curWeekDataNum, recordFloat)
			}
		} else {
			for i := int(1); i < len(record); i++ {
				recordFloat, _ := strconv.ParseFloat(record[i], 64)
				curWeekDataNum[i-1] = curWeekDataNum[i-1] + recordFloat
			}
		}
		// if weekday is Monday
		if weekDayNum == 1 {
			curWeekData = append(curWeekData, record[0])
			sum := float64(0)
			for _, dataNum := range curWeekDataNum {
				curWeekData = append(curWeekData, fmt.Sprintf("%f", dataNum))
				sum += dataNum
			}
			curWeekData = append(curWeekData, fmt.Sprintf("%f", sum))
			res = append(res, curWeekData)
			curWeekData = make([]string, 0)
			curWeekDataNum = make([]float64, 0)
		}
		lastTime = dateRec
	}
	if len(curWeekDataNum) > 0 {
		// check nearest week
		for i := int(1); i < 7; i++ {
			nextDay := lastTime.AddDate(0, 0, i)
			if int(nextDay.Weekday()) == 1 {
				curWeekData = append(curWeekData, nextDay.Format("2006-01-02"))
				sum := float64(0)
				for _, dataNum := range curWeekDataNum {
					curWeekData = append(curWeekData, fmt.Sprintf("%f", dataNum))
					sum += dataNum
				}
				curWeekData = append(curWeekData, fmt.Sprintf("%f", sum))
				res = append(res, curWeekData)
				break
			}
		}
	}
	return res
}

func GroupByMonthlyData(records [][]string) [][]string {
	currentMonth := ""
	currentYear := ""
	res := make([][]string, 0)
	curMonthData := make([]string, 0)
	for index, record := range records {
		// date string
		dateArray := strings.Split(record[0], "-")
		if currentMonth == "" {
			currentYear = dateArray[0]
			currentMonth = dateArray[1]
			curMonthData = append(curMonthData, fmt.Sprintf("%s-%s", dateArray[0], dateArray[1]))
			for i := 1; i < len(record); i++ {
				curMonthData = append(curMonthData, record[i])
			}
		} else if dateArray[0] != currentYear || dateArray[1] != currentMonth {
			currentYear = dateArray[0]
			currentMonth = dateArray[1]
			res = append(res, curMonthData)
			curMonthData = make([]string, 0)
			curMonthData = append(curMonthData, fmt.Sprintf("%s-%s", dateArray[0], dateArray[1]))
			for i := 1; i < len(record); i++ {
				curMonthData = append(curMonthData, record[i])
			}
		} else {
			for i := 1; i < len(record); i++ {
				curFloat, _ := strconv.ParseFloat(curMonthData[i], 64)
				recordFloat, _ := strconv.ParseFloat(record[i], 64)
				curMonthData[i] = fmt.Sprintf("%f", curFloat+recordFloat)
			}
		}
		if index == len(records)-1 {
			res = append(res, curMonthData)
		}
	}
	for index, resItem := range res {
		sum := SumVolOfBwRow(resItem)
		resItem = append(resItem, fmt.Sprintf("%f", sum))
		res[index] = resItem
	}
	return res
}
