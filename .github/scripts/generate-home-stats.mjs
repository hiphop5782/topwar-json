import fs from "node:fs";
import path from "node:path";

// topwar-json 저장소 루트에서 실행한다.
const JSON_ROOT = process.cwd();

const OUTPUT_PATH = path.join(
    JSON_ROOT,
    "generated/homeStatistics.json"
);

const DAY = 60 * 60 * 24;


// ========================================
// 공통
// ========================================

const readJson = file =>
    JSON.parse(
        fs.readFileSync(file, "utf-8")
    );


const rate = (value, total) => {

    if (!total) return 0;

    return Number(
        (value / total * 100).toFixed(2)
    );

};


const quantile = (values, q) => {

    if (!values.length) return 0;

    const position =
        (values.length - 1) * q;

    const base =
        Math.floor(position);

    const rest =
        position - base;

    const next =
        values[base + 1] ?? values[base];

    return Math.round(
        values[base] +
        (next - values[base]) * rest
    );

};


// ========================================
// 원본 데이터
// ========================================

const players = readJson(
    path.join(
        JSON_ROOT,
        "power/playerData.json"
    )
);


const servers = readJson(
    path.join(
        JSON_ROOT,
        "power/serverData.json"
    )
);


// ========================================
// 기준 시각
//
// Date.now()를 쓰지 않음.
//
// 데이터 수집 시점 기준으로 활동률을
// 계산해야 결과가 안정적임.
// ========================================

const snapshotUnix = Math.max(
    ...players
        .map(player =>
            Number(player.lastRequest ?? 0)
        )
        .filter(Number.isFinite)
);


const snapshotAt =
    new Date(snapshotUnix * 1000)
        .toISOString();


// ========================================
// 활동 사용자
// ========================================

const countActive = days => {

    const limit =
        DAY * days;

    return players.filter(player => {

        const lastLogin =
            Number(player.lastLogin);

        if (
            !Number.isFinite(lastLogin) ||
            lastLogin <= 0
        ) {
            return false;
        }

        return (
            snapshotUnix - lastLogin
            <= limit
        );

    }).length;

};


const active1d =
    countActive(1);

const active3d =
    countActive(3);

const active7d =
    countActive(7);

const active14d =
    countActive(14);

const active30d =
    countActive(30);


const online =
    players.filter(player =>
        player.online === true ||
        player.isOnline === true
    ).length;


// ========================================
// UID
// ========================================

const uniquePlayers =
    new Set(
        players.map(
            player => String(player.uid)
        )
    ).size;


// ========================================
// 레벨
// ========================================

const level100 =
    players.filter(
        player =>
            Number(player.level) === 100
    ).length;


// ========================================
// 연맹 가입
// ========================================

const allianceJoined =
    players.filter(
        player =>
            Number(player.allianceId ?? 0) > 0
    ).length;


// ========================================
// 전투력
// ========================================

const powerList =
    players
        .map(player =>
            Number(
                player.cp ??
                player.score ??
                0
            )
        )
        .filter(power =>
            Number.isFinite(power) &&
            power > 0
        )
        .sort((a, b) => a - b);


const averagePower =
    Math.round(
        powerList.reduce(
            (sum, power) =>
                sum + power,
            0
        ) /
        powerList.length
    );


// ========================================
// 서버 변화 기록
// ========================================

const SERVER_HISTORY_DIR =
    path.join(
        JSON_ROOT,
        "servers"
    );


const serverHistory =
    fs.readdirSync(
        SERVER_HISTORY_DIR
    )
    .map(filename => {

        const match =
            filename.match(
                /^servers-(\d{4}-\d{2}-\d{2})\.json$/
            );

        if (!match) {
            return null;
        }

        const data =
            readJson(
                path.join(
                    SERVER_HISTORY_DIR,
                    filename
                )
            );

        return {
            date: match[1],
            count: data.length
        };

    })
    .filter(Boolean)
    .sort(
        (a, b) =>
            a.date.localeCompare(b.date)
    );


function getServerChange(days) {

    if (!serverHistory.length) {
        return 0;
    }

    const latest =
        serverHistory.at(-1);

    const date =
        new Date(
            `${latest.date}T00:00:00Z`
        );

    date.setUTCDate(
        date.getUTCDate() - days
    );

    const target =
        date
            .toISOString()
            .slice(0, 10);


    const previous =
        [...serverHistory]
            .reverse()
            .find(
                item =>
                    item.date <= target
            );


    if (!previous) {
        return 0;
    }

    return (
        latest.count -
        previous.count
    );

}


// ========================================
// 일별 변경 데이터
// ========================================

function getLatestDailyData(
    directoryName
) {

    const directory =
        path.join(
            JSON_ROOT,
            "power",
            directoryName
        );


    if (!fs.existsSync(directory)) {
        return null;
    }


    const files =
        fs.readdirSync(directory)
            .filter(filename =>
                /^\d{4}-\d{2}-\d{2}\.json$/
                    .test(filename)
            )
            .sort();


    if (!files.length) {
        return null;
    }


    const filename =
        files.at(-1);

    const data =
        readJson(
            path.join(
                directory,
                filename
            )
        );


    return {
        date:
            data.date ??
            filename.replace(".json", ""),

        count:
            Array.isArray(data.rows)
                ? data.rows.length
                : 0,

        updatedAt:
            data.updatedAt ?? null
    };

}


const movement =
    getLatestDailyData(
        "movement"
    );


const nickname =
    getLatestDailyData(
        "nickname"
    );


// ========================================
// Real Power
// ========================================

const REAL_POWER_DIR =
    path.join(
        JSON_ROOT,
        "realpower"
    );


const activityGrades = {
    VERY_ACTIVE: 0,
    ACTIVE: 0,
    NORMAL: 0,
    QUIET: 0,
    DEAD: 0,
    UNKNOWN: 0
};


let analyzedServers = 0;


for (
    const filename of
    fs.readdirSync(REAL_POWER_DIR)
) {

    if (
        !/^\d+\.json$/
            .test(filename)
    ) {
        continue;
    }


    const data =
        readJson(
            path.join(
                REAL_POWER_DIR,
                filename
            )
        );


    const summary =
        data.summary ?? {};


    // 파일만 존재하고 실제 지도 조사 결과가 없는 빈 서버는
    // serverActivity.grade가 DEAD로 초기화되어 있어도 분석 대상이 아니다.
    // 이런 placeholder를 포함하면 미조사 서버 전체가 비활성으로 집계된다.
    const hasSurveyData =
        Number(summary.players ?? 0) > 0
        || Number(summary.mapPlayers ?? 0) > 0
        || Number(summary.alliances ?? 0) > 0
        || (Array.isArray(data.players) && data.players.length > 0)
        || (Array.isArray(data.alliances) && data.alliances.length > 0);


    if (!hasSurveyData) {
        continue;
    }


    const grade =
        summary
            .serverActivitySummary
            ?.serverActivityGrade
        ??
        summary
            .serverActivity
            ?.grade
        ??
        "UNKNOWN";


    activityGrades[grade] =
        (activityGrades[grade] ?? 0)
        + 1;


    analyzedServers++;

}


// ========================================
// Kartz
// ========================================

const KARTZ_HISTORY_DIR =
    path.join(
        JSON_ROOT,
        "kartz",
        "history"
    );


const kartzHistoryFiles =
    fs.existsSync(KARTZ_HISTORY_DIR)
        ? fs.readdirSync(KARTZ_HISTORY_DIR)
            .filter(filename =>
                /^\d{4}-\d{2}\.json$/
                    .test(filename)
            )
            .sort()
        : [];


const latestKartzFilename =
    kartzHistoryFiles.at(-1) ?? null;


const latestKartz =
    latestKartzFilename
        ? readJson(
            path.join(
                KARTZ_HISTORY_DIR,
                latestKartzFilename
            )
        )
        : null;


const kartzPlayers =
    Array.isArray(latestKartz?.playerRankList)
        ? [...latestKartz.playerRankList]
            .sort(
                (a, b) =>
                    Number(a.rank ?? Infinity) -
                    Number(b.rank ?? Infinity)
            )
        : [];


const kartzAlliances =
    Array.isArray(latestKartz?.allianceRankList)
        ? [...latestKartz.allianceRankList]
            .sort(
                (a, b) =>
                    Number(a.rank ?? Infinity) -
                    Number(b.rank ?? Infinity)
            )
        : [];


const topKartzPlayer =
    kartzPlayers.at(0) ?? null;


const kartzCutoffPlayer =
    kartzPlayers.at(-1) ?? null;


const topKartzAlliance =
    kartzAlliances.at(0) ?? null;


const kartzServerMap = new Map();


for (const player of kartzPlayers) {

    const server = Number(player.server);
    const round = Number(player.round ?? 0);

    if (!Number.isFinite(server)) {
        continue;
    }

    const current =
        kartzServerMap.get(server)
        ?? {
            server,
            playerCount: 0,
            roundTotal: 0
        };

    current.playerCount++;
    current.roundTotal += round;

    kartzServerMap.set(
        server,
        current
    );

}


const topKartzServer =
    [...kartzServerMap.values()]
        .map(server => ({
            server:
                server.server,

            playerCount:
                server.playerCount,

            averageRound:
                Number(
                    (
                        server.roundTotal /
                        server.playerCount
                    ).toFixed(2)
                )
        }))
        .sort(
            (a, b) =>
                b.playerCount - a.playerCount
                || b.averageRound - a.averageRound
                || a.server - b.server
        )
        .at(0) ?? null;


// ========================================
// 최종 통계
// ========================================

const statistics = {

    generatedAt:
        new Date().toISOString(),

    snapshotAt,


    server: {

        count:
            servers.length,

        change1d:
            getServerChange(1),

        change7d:
            getServerChange(7),

        change30d:
            getServerChange(30),

        history:
            serverHistory

    },


    player: {

        tracked:
            players.length,

        unique:
            uniquePlayers,

        online,

        onlineRate:
            rate(
                online,
                players.length
            ),

        level100,

        level100Rate:
            rate(
                level100,
                players.length
            ),

        allianceJoined,

        allianceJoinedRate:
            rate(
                allianceJoined,
                players.length
            ),


        activity: {

            within1d:
                active1d,

            within1dRate:
                rate(
                    active1d,
                    players.length
                ),

            within3d:
                active3d,

            within3dRate:
                rate(
                    active3d,
                    players.length
                ),

            within7d:
                active7d,

            within7dRate:
                rate(
                    active7d,
                    players.length
                ),

            within14d:
                active14d,

            within14dRate:
                rate(
                    active14d,
                    players.length
                ),

            within30d:
                active30d,

            within30dRate:
                rate(
                    active30d,
                    players.length
                )

        }

    },


    power: {

        average:
            averagePower,

        median:
            quantile(
                powerList,
                0.5
            ),

        top25Threshold:
            quantile(
                powerList,
                0.75
            ),

        top10Threshold:
            quantile(
                powerList,
                0.90
            ),

        top5Threshold:
            quantile(
                powerList,
                0.95
            ),

        top1Threshold:
            quantile(
                powerList,
                0.99
            ),

        max:
            powerList.at(-1) ?? 0

    },


    changes: {
        movement,
        nickname
    },


    realPower: {

        analyzedServers,

        activityGrades

    },


    kartz: latestKartz
        ? {
            month:
                latestKartzFilename
                    .replace(".json", ""),

            recordedAt:
                latestKartz.time ?? null,

            playerCount:
                kartzPlayers.length,

            allianceCount:
                kartzAlliances.length,

            topPlayer:
                topKartzPlayer
                    ? {
                        rank:
                            Number(topKartzPlayer.rank),
                        nickname:
                            topKartzPlayer.nickname ?? null,
                        server:
                            Number(topKartzPlayer.server),
                        round:
                            Number(topKartzPlayer.round),
                        profile:
                            topKartzPlayer.profile ?? null
                    }
                    : null,

            cutoff:
                kartzCutoffPlayer
                    ? {
                        rank:
                            Number(kartzCutoffPlayer.rank),
                        round:
                            Number(kartzCutoffPlayer.round),
                        damage:
                            kartzCutoffPlayer.damage ?? null
                    }
                    : null,

            topAlliance:
                topKartzAlliance
                    ? {
                        rank:
                            Number(topKartzAlliance.rank),
                        name:
                            topKartzAlliance.name ?? null,
                        tag:
                            topKartzAlliance.tag ?? null,
                        server:
                            Number(topKartzAlliance.server),
                        score:
                            Number(topKartzAlliance.score ?? 0)
                    }
                    : null,

            topServer:
                topKartzServer
        }
        : null

};


// ========================================
// 저장
// ========================================

fs.mkdirSync(
    path.dirname(OUTPUT_PATH),
    {
        recursive: true
    }
);


fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
        statistics,
        null,
        4
    ),
    "utf-8"
);


console.log(
    "[Home Statistics]",
    OUTPUT_PATH
);
