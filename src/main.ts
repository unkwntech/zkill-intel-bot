import axios from "axios";
import { parse } from "node-html-parser";
import { env } from "process";

const systems = require("../system_id.json");
const COOLDOWNTIMER = 5 * 60;
const QUEUEID = encodeURI("IBN KHATAB shh relay");
const TTW = 10;
const ZKILLURL = `https://zkillredisq.stream/listen.php?queueID=${QUEUEID}&ttw=${TTW}`;
const ERRORPERIOD = 60;
const ERRORCOUNTMAX = 5;
const OLDESTKILL = 10;

const CARRIERS = [
    23757, // Archon
    23915, // Chimera
    24483, // Nidhoggur
    23911, // Thanatos
];
const CAPITALINDUSTRIALS = [
    883, // Rorqual
];
const FORCEAUXILLIARIES = [
    37604, // Apostle
    42242, // Dagon
    37606, // Lif
    37605, // Minokawa
    45645, // Loggerhead
    37607, // Ninazu
];
const DREADNAUGHTS = [
    19720, // Revelation
    73790, // Revelation Navy Issue
    77283, // Bane
    42243, // Chemosh
    19726, // Phoenix
    73793, // Phoenix Navy Issue
    77284, // Karura
    45647, // Caiman
    19722, // Naglfar
    73787, // Naglfar Fleet Issue
    77288, // Valravn
    19724, // Moros
    73792, // Moros Navy Issue
    77281, // Hubris
    42124, // Vehement
    52907, // Zirnitra
    87381, // Sarathiel
];
const INTERESTINGATTACKERS = [
    ...CARRIERS,
    ...CAPITALINDUSTRIALS,
    ...FORCEAUXILLIARIES,
    ...DREADNAUGHTS,
];
enum states {
    READY,
    BUSY,
}

const cooldowns: { id: number; timer: number }[] = [];
const errors: { error: Error; timestamp: Date }[] = [];
const queue: ZKillPackage[] = [];
let STATE: states = states.READY;

const INTERESTINGSYSTEMS: number[] = [];

async function processKill() {
    console.log("processKill");
    let message = queue.pop();
    if (!message) return;
    if (
        new Date(message.killmail.killmail_time).getTime() <
        new Date().getTime() - OLDESTKILL * 60 * 1000
    ) {
        return;
    }
    console.log(message.killID);
    try {
        for (let attacker of message.killmail.attackers as ZKillAttacker[]) {
            if (
                INTERESTINGATTACKERS.includes(attacker.ship_type_id) &&
                INTERESTINGSYSTEMS.includes(message.killmail.solar_system_id)
            ) {
                let cd = cooldowns.find(
                    (c) => c.id === message.killmail.solar_system_id
                );
                if (!cd) {
                    cooldowns.push({
                        id: message.killmail.solar_system_id,
                        timer: COOLDOWNTIMER,
                    });
                } else {
                    if (cd.timer > 0) {
                        return;
                    }
                }
                let output = {
                    username: "Recon Bot",
                } as DiscordMessage;

                output.embeds = [
                    { fields: [] as DiscordField[] } as DiscordEmbed,
                ];

                if (DREADNAUGHTS.includes(attacker.ship_type_id))
                    output.embeds[0].title = "**Dread Used!**";
                if (CARRIERS.includes(attacker.ship_type_id))
                    output.embeds[0].title = "**Carrier Used!**";
                if (CAPITALINDUSTRIALS.includes(attacker.ship_type_id))
                    output.embeds[0].title = "**Capital Industrial Used!**";
                if (FORCEAUXILLIARIES.includes(attacker.ship_type_id))
                    output.embeds[0].title = "**FAX Used!**";

                let charInfo = await GetCharacterInfo(attacker.character_id);
                let systemInfo = await GetSolarSystemInfo(
                    message.killmail.solar_system_id
                );
                //pilot
                output.embeds[0].fields[0] = {
                    name: "Pilot",
                    value: `**${charInfo.name}\n[Zkill](https://zkillboard.com/character/${charInfo.id}/)**`,
                    inline: true,
                };
                //corp
                output.embeds[0].fields.push({
                    name: "Corp",
                    value: `[${charInfo.corpTicker}] ${charInfo.corpName}\n[Zkill](https://zkillboard.com/corporation/${charInfo.corpID}/)`,
                    inline: true,
                });
                //alliance
                output.embeds[0].fields.push({
                    name: "Alliance",
                    value: `[${charInfo.allianceTicker}] ${charInfo.allianceName}\n[Zkill](https://zkillboard.com/alliance/${charInfo.allianceID}/)`,
                    inline: true,
                });
                //system
                output.embeds[0].fields.push({
                    name: "System",
                    value: `${
                        systemInfo.name
                    }\n[Zkill](https://zkillboard.com/system/${
                        message.killmail.solar_system_id
                    }/) / [Dotlan](https://evemaps.dotlan.net/map/${systemInfo.region.replaceAll(
                        " ",
                        "_"
                    )}/${systemInfo.name.replaceAll(" ", "_")})`,
                    inline: true,
                });
                //kill
                output.embeds[0].fields.push({
                    name: "Kill",
                    value: `https://zkillboard.com/kill/${message.killID}/`,
                    inline: false,
                });

                sendMessage(output);
            }
        }
    } catch (e) {
        console.error(e);
    }
}
async function sendMessage(message: DiscordMessage) {
    console.log("sendMessage");
    //send webhook
    axios.post(env.webhook, message);
}
async function getNextKill() {
    if (STATE != states.READY) return;
    console.log("getNextKill");
    if (getErrorCount() > ERRORCOUNTMAX) {
        STATE = states.BUSY;
        //sendMessage({ content: "ERROR COUNT TOO HIGH, PAUSING" });
        console.error("ERROR COUNT TOO HIGH, PAUSING");
        setTimeout(() => {
            STATE = states.READY;
            console.error("RESUMING");
        }, 300000);
        return;
    }

    STATE = states.BUSY;

    /**
        Squizz Caphinator[EVE] — 13:43
        there is a delay on the redisq side from 500ms to 2500ms, even after your timeout, to ensure that packages are cached and increasing your chances of hitting the cache up to about 99.5%
        https://discord.com/channels/849992399639281694/850216522266050570/1408884427395829942
    **/

    axios
        .get<ZKillMessage>(ZKILLURL, {
            timeout: TTW * 1000 + 2750,
        })
        .then((res) => {
            queue.push(res.data.package);
            STATE = states.READY;
        })
        .catch((err) => {
            //conn timeout, this doesn't count as an error.
            if (err.code === "ECONNABORTED") {
                STATE = states.READY;
                return;
            }
            console.error(err);
            errors.push({ error: err, timestamp: new Date() });
            STATE = states.READY;
        });
}
function getErrorCount(): number {
    return errors.filter((e) => {
        return e.timestamp.getTime() >= Date.now() - ERRORPERIOD * 1000;
    }).length;
}

async function init() {
    console.log("init");
    INTERESTINGSYSTEMS.push(...(await GetRoutes()));
    //set timer to manage cooldowns
    setInterval(() => {
        for (let i = 0; i < cooldowns.length; i++) {
            cooldowns[i].timer -= 30;
            if (cooldowns[i].timer <= 0) {
                cooldowns.splice(i, 1);
            }
        }
    }, 30000);
    //set timer to attempt to fetch new kills
    setInterval(getNextKill, 1000);
    //set timer to process kills from queue
    setInterval(processKill, 1000);
}

init();

async function GetRoutes(): Promise<number[]> {
    console.log("GetRoutes");
    let interestingSystems = [];
    let interests: { action: string; channel: string }[] = [];
    let systemList = (
        await axios.get(`https://evemaps.dotlan.net/range/Avatar,5/Amamake`)
    ).data;

    let html = parse(systemList);
    let rows = html
        .getElementsByTagName("table")[1]
        .getElementsByTagName("tbody")[0]
        .getElementsByTagName("tr");

    for (let i = 0; i < rows.length; i++) {
        let row = rows[i];
        let systemName = row.getElementsByTagName("td")[2].innerText.trim();

        interestingSystems.push(
            systems.find((s: any) => s.name === systemName).id
        );
    }

    return interestingSystems;
}

async function GetCharacterInfo(id: number): Promise<Partial<CharInfo>> {
    let charInfo = {} as {
        corporation_id: number;
        alliance_id: number;
        name: string;
    };
    await axios
        .get(`https://esi.evetech.net/characters/${id}`)
        .then((res) => {
            console.log("1", res);
            charInfo = res.data;
        })
        .catch((e) => {
            console.error(e);
        });

    return {
        id,
        name: charInfo.name,
        corpID: charInfo.corporation_id,
        allianceID: charInfo.alliance_id ?? -1,
        ...(await GetCorpInfo(charInfo.corporation_id)),
        ...(await GetAlliName(charInfo.alliance_id ?? -1)),
    } as Partial<CharInfo>;
}

async function GetCorpInfo(
    id: number
): Promise<{ corpName: string; corpTicker: string }> {
    let corpInfo = {} as { name: string; ticker: string };
    await axios
        .get(`https://esi.evetech.net/corporations/${id}`)
        .then((res) => {
            console.log("2", res);
            corpInfo = res.data;
        })
        .catch((e) => {
            console.error(e);
        });

    return {
        corpName: corpInfo.name,
        corpTicker: corpInfo.ticker,
    };
}

async function GetSolarSystemInfo(
    id: number
): Promise<{ name: string; region: string }> {
    let systemInfo = {} as { name: string; constellation_id: number };
    await axios
        .get(`https://esi.evetech.net/universe/systems/${id}`)
        .then((res) => {
            console.log("3", res);
            systemInfo = res.data;
        })
        .catch((e) => {
            console.error(e);
        });
    let constInfo = {} as { region_id: number };
    await axios
        .get(
            `https://esi.evetech.net/universe/constellations/${systemInfo.constellation_id}`
        )
        .then((res) => {
            console.log("4", res);
            constInfo = res.data;
        })
        .catch((e) => {
            console.error(e);
        });
    let regionInfo = {} as { name: string };
    await axios
        .get(`https://esi.evetech.net/universe/regions/${constInfo.region_id}`)
        .then((res) => {
            console.log("5", res);
            regionInfo = res.data;
        })
        .catch((e) => {
            console.error(e);
        });

    return {
        name: systemInfo.name,
        region: regionInfo.name,
    };
}

async function GetAlliName(
    id: number
): Promise<{ allianceName: string; allianceTicker: string }> {
    if (id === -1) return { allianceName: "", allianceTicker: "" };

    let alliInfo = (
        await axios
            .get(`https://esi.evetech.net/alliances/${id}`)
            .then((res) => {
                console.log("6", res);
                return res;
            })
            .catch((e) => {
                console.error(e);
                return { data: {} };
            })
    ).data;
    return {
        allianceName: alliInfo.name,
        allianceTicker: alliInfo.ticker,
    };
}

interface CharInfo {
    id: number;
    name: string;

    corpID: number;
    corpName: string;
    corpTicker: string;

    allianceID: number;
    allianceName: string;
    allianceTicker: string;
}
interface ZKillMessage {
    package: ZKillPackage;
}
interface ZKillPackage {
    killID: Number;
    killmail: ZKillKillmail;
    zkb: ZKillZKB;
}
interface ZKillKillmail {
    attackers: ZKillAttacker[]; //?
    killmail_id: number;
    killmail_time: Date;
    solar_system_id: number;
    victim: ZKillVictim;
}
interface ZKillCharacter {
    alliance_id?: number;
    character_id: number;
    corporation_id: number;
}
interface ZKillVictim extends ZKillCharacter {
    damage_taken: number;
    items: ZKillItem[];
    position: ZKillPosition;
    ship_type_id: number;
}
interface ZKillAttacker extends ZKillCharacter {
    damage_done: number;
    final_blow: boolean;
    security_status: number;
    ship_type_id: number;
    weapon_type_id: number;
}
interface ZKillZKB {
    locationID: number;
    hash: string;
    fittedValue: number;
    droppedValue: number;
    destroyedValue: number;
    totalValue: number;
    points: number;
    npc: boolean;
    solo: boolean;
    awox: boolean;
    labels: string[];
    href: string;
}
interface ZKillPosition {
    x: number;
    y: number;
    z: number;
}
interface ZKillItem {
    flag: number;
    item_type_id: number;
    quantity_dropped: number;
    singleton: number;
}
interface DiscordMessage {
    content?: string;
    tts?: boolean;
    embeds?: DiscordEmbed[];
    username?: string;
}
interface DiscordEmbed {
    id?: number;
    fields: DiscordField[];
    title: string;
}
interface DiscordField {
    id?: number;
    name: string;
    value: string;
    inline: boolean;
}
async function sleep(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
