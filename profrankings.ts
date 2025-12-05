/*

  ProfRankings.ts

  @author Emery Berger <emery@cs.umass.edu> http://www.emeryberger.com

*/

/// <reference path="./typescript/he/index.d.ts" />
/// <reference path="./typescript/jquery.d.ts" />
/// <reference path="./typescript/vega-embed.d.ts" />
/// <reference path="./typescript/papaparse.d.ts" />
/// <reference path="./typescript/navigo.d.ts" />
/// <reference path="./typescript/continents.d.ts" />

declare function escape(s: string): string;
declare function unescape(s: string): string;

interface AuthorInfo {
    readonly name: string;
    readonly affiliation: string;
    readonly homepage: string;
    readonly scholarid: string;
};

interface DBLPName {
    readonly name: string;
    readonly dblpname: string;
};

interface Author {
    name: string;
    readonly dept: string;
    readonly area: string;
    readonly subarea: string;
    readonly count: string;
    readonly adjustedcount: string;
    readonly year: number;
};

interface CountryInfo {
    readonly institution: string;
    readonly region: "us" | "europe" | "ca" | "northamerica" | "australasia" | "southamerica" | "asia" | "africa" | "world";
    readonly countryabbrv: string;
};

interface CountryName {
    readonly name: string;
    readonly alpha_2: string;
};

interface Alias {
    readonly alias: string;
    readonly name: string;
};

interface Turing {
    readonly name: string;
    readonly year: number;
};

interface ACMFellow {
    readonly name: string;
    readonly year: number;
};

interface HomePage {
    readonly name: string;
    readonly homepage: string;
};

interface ScholarID {
    readonly name: string;
    readonly scholarid: string;
};

interface AreaMap {
    readonly area: string;
    readonly title: string;
};

interface ChartData {
    readonly area: string;
    readonly value: number;
};

class ProfRankings {

    private static theInstance: ProfRankings; // singleton for this object

    private static minToRank = 30; // initial number to rank --> should be enough to enable a scrollbar
    public static readonly areas: Array<string> = [];
    public static readonly topLevelAreas: { [key: string]: string } = {};
    public static readonly topTierAreas: { [key: string]: string } = {};
    public static readonly regions: Array<string> = ["europe", "northamerica", "southamerica", "australasia", "asia", "africa", "world", "ae","ar","at","au","bd","be","bg","br","ca","ch","cl","cn","co","cy","cz","de","dk","ee","eg","es","fi","fr","gr","hk","hu","ie","il","in","ir","it","jo","jp","kr","lb","lk","lu","mt","my","nl","no","nz","ph","pk","pl","pt","qa","ro","ru","sa","se","sg","th","tr","tw","uk","us","vn","za"];
    private static readonly nameMatcher = new RegExp('(.*)\s+\[(.*)\]'); // Matches names followed by [X] notes.

    private note: { [name: string]: string } = {};

    private navigoRouter: Navigo;

    // We have scrolled: increase the number we rank.
    public static updateMinimum(obj: any): number {
        if (ProfRankings.minToRank <= 500) {
            const t = obj.scrollTop;
            ProfRankings.minToRank = 5000;
            ProfRankings.getInstance().rank();
            return t;
        } else {
            return 0;
        }
    }

    // Return the singleton corresponding to this object.
    public static getInstance(): ProfRankings {
        return ProfRankings.theInstance;
    }

    // Promises polyfill.
    public static promise(cont: () => void): void {
        if (typeof Promise !== "undefined") {
            var resolved = Promise.resolve();
            resolved.then(cont);
        } else {
            setTimeout(cont, 0);
        }
    }

    constructor() {
        ProfRankings.theInstance = this;
        this.navigoRouter = new Navigo(null, true);

        /* Build dictionaries:
	   areaDict: areas -> names used in pie charts
           areaPosition: areas -> position in area array
	   subareas: subareas -> areas (e.g., "Vision" -> "ai")
        */
        for (let position = 0; position < this.areaMap.length; position++) {
            const { area, title } = this.areaMap[position];
            ProfRankings.areas[position] = area;
            if (!(area in ProfRankings.parentMap)) {
                ProfRankings.topLevelAreas[area] = area;
            }
            if (!(area in ProfRankings.nextTier)) {
                ProfRankings.topTierAreas[area] = area;
            }
            this.areaNames[position] = title;
            this.fields[position] = area;
            this.areaDict[area] = title; // this.areaNames[position];
            this.areaPosition[area] = position;
        }
	const subareaList = [
            ...this.aiAreas.map(key =>
                ({[this.areaDict[key]] : "ai" })),
            ...this.systemsAreas.map(key =>
                ({[this.areaDict[key]] : "systems"})),
            ...this.theoryAreas.map(key =>
                ({[this.areaDict[key]] : "theory"})),
            ...this.interdisciplinaryAreas.map(key =>
                ({[this.areaDict[key]] : "interdisciplinary"})),
        ];
	for (const item of subareaList) {
	    for (const key in item) {
	    	this.subareas[key] = item[key];
	    }
	}
        for (const area of this.aiAreas) {
            this.aiFields.push(this.areaPosition[area]);
        }
        for (const area of this.systemsAreas) {
            this.systemsFields.push(this.areaPosition[area]);
        }
        for (const area of this.theoryAreas) {
            this.theoryFields.push(this.areaPosition[area]);
        }
        for (const area of this.interdisciplinaryAreas) {
            this.otherFields.push(this.areaPosition[area]);
        }
        let parentCounter = 0;
        for (const child in ProfRankings.parentMap) {
            const parent = ProfRankings.parentMap[child];
            if (!(parent in ProfRankings.childMap)) {
                ProfRankings.childMap[parent] = [child];
                ProfRankings.parentIndex[parent] = parentCounter;
                parentCounter += 1;
            } else {
                ProfRankings.childMap[parent].push(child);
            }
        }
        this.displayProgress(1);
        (async () => {
            await this.loadTuring(this.turing);
            await this.loadACMFellow(this.acmfellow);
            this.displayProgress(2);
            await this.loadAuthorInfo();
            this.displayProgress(3);
            await this.loadAuthors();
            this.setAllOn();
            this.navigoRouter.on({
                '/index': this.navigation,
                '/fromyear/:fromyear/toyear/:toyear/index': this.navigation
            }).resolve();
            this.displayProgress(4);
            this.countAuthorAreas();
            await this.loadCountryInfo(this.countryInfo, this.countryAbbrv);
            await this.loadCountryNames(this.countryNames);
            this.addListeners();
            ProfRankings.geoCheck();
            this.rank();
	    // We've finished loading; remove the overlay.
	    document!.getElementById("overlay-loading")!.style.display = "none";
	    // Randomly display a survey.
	    const surveyFrequency = 1000000; // One out of this many users gets the survey (on average).
	    // Check to see if survey has already been displayed.
	    let displaySurvey = false;
	    // Keep the cookie for backwards compatibility (for now).
	    let shownAlready = document.cookie.split('; ').find(row => row.startsWith('surveyDisplayed')) ||
		localStorage.getItem('surveyDisplayed');
	    // DISABLE SURVEY (remove the next line to re-enable)
	    shownAlready = 'disabled';
            if (!shownAlready) {
		// Not shown yet.
		const randomValue = Math.floor(Math.random() * surveyFrequency);
		displaySurvey = (randomValue == 0);
		if (displaySurvey) {
		    localStorage.setItem('surveyDisplayed', 'true');
		    // Now reveal the survey.
	            document!.getElementById("overlay-survey")!.style.display = "block";
		}
            }
	    // Randomly display a sponsorship request.
	    // In the future, tie to amount of use of the site, a la Wikipedia.
	    const sponsorshipFrequency = 5; // One out of this many users gets the sponsor page (on average).
	    // Check to see if the sponsorship page has already been displayed.
            if (!localStorage.getItem('sponsorshipDisplayed')) {
		// Not shown yet.
		const randomValue = Math.floor(Math.random() * sponsorshipFrequency);
		const displaySponsor = (randomValue == 0);
		if (!displaySurvey && displaySponsor) { // Only show if we have not shown the survey page as well.
		    localStorage.setItem('sponsorshipDisplayed', 'true');
		    // Now reveal the sponsorship page.
	            document!.getElementById("overlay-sponsor")!.style.display = "block";
		}
	    }
        })();
    }

    private readonly authorFile = "./csrankings.csv";
    private readonly authorinfoFile = "./generated-author-info.csv";
    private readonly countryinfoFile = "./institutions.csv";
    private readonly countrynamesFile = "./countries.csv";
    // private readonly aliasFile = "./dblp-aliases.csv";
    private readonly turingFile = "./turing.csv";
    private readonly turingImage = "./png/acm-turing-award.png";
    private readonly acmfellowFile = "./acm-fellows.csv";
    private readonly acmfellowImage = "./png/acm.png";
    private readonly homepageImage = "./png/house-logo.png";

    private readonly allowRankingChange = false;   /* Can we change the kind of rankings being used? */

    public static readonly parentIndex: { [key: string]: number } = {}; // For color lookups

    public static readonly parentMap: { [key: string]: string }
        = {
            'aaai': 'ai',
            'ijcai': 'ai',
            'cvpr': 'vision',
            'eccv': 'vision',
            'iccv': 'vision',
            'icml': 'mlmining',
	    'iclr': 'mlmining',
            'kdd': 'mlmining',
            'nips': 'mlmining',
            'acl': 'nlp',
            'emnlp': 'nlp',
            'naacl': 'nlp',
            'sigir': 'inforet',
            'www': 'inforet',
            'asplos': 'arch',
            'isca': 'arch',
            'micro': 'arch',
            'hpca': 'arch', // next tier
            'ccs': 'sec',
            'oakland': 'sec',
            'usenixsec': 'sec',
            'ndss': 'sec', // next tier (for now)
            'pets': 'sec', // next tier
            'vldb': 'mod',
            'sigmod': 'mod',
            'icde': 'mod', // next tier
            'pods': 'mod',
            'dac': 'da',
            'iccad': 'da',
            'emsoft': 'bed',
            'rtas': 'bed',
            'rtss': 'bed',
            'sc': 'hpc',
            'hpdc': 'hpc',
            'ics': 'hpc',
            'mobicom': 'mobile',
            'mobisys': 'mobile',
            'sensys': 'mobile',
            'imc': 'metrics',
            'sigmetrics': 'metrics',
            'osdi': 'ops',
            'sosp': 'ops',
            'eurosys': 'ops',    // next tier (see below)
            'fast': 'ops',       // next tier
            'usenixatc': 'ops',  // next tier
            'popl': 'plan',
            'pldi': 'plan',
            'oopsla': 'plan', // next tier 
            'icfp': 'plan',   // next tier
            'fse': 'soft',
            'icse': 'soft',
            'ase': 'soft',    // next tier
            'issta': 'soft',  // next tier
            'nsdi': 'comm',
            'sigcomm': 'comm',
            'siggraph': 'graph',
            'siggraph-asia': 'graph',
            'eurographics': 'graph', // next tier
            'focs': 'act',
            'soda': 'act',
            'stoc': 'act',
            'crypto': 'crypt',
            'eurocrypt': 'crypt',
            'cav': 'log',
            'lics': 'log',
            'ismb': 'bio',
            'recomb': 'bio',
            'ec': 'ecom',
            'wine': 'ecom',
            'chiconf': 'chi',
            'ubicomp': 'chi',
            'uist': 'chi',
            'icra': 'robotics',
            'iros': 'robotics',
            'rss': 'robotics',
            'vis': 'visualization',
            'vr': 'visualization',
	    'sigcse': 'csed'
        };

    public static readonly nextTier: { [key: string]: boolean } =
        {
            'ase': true,
            'issta': true,
            'icde': true,
            'pods': true,
            'hpca': true,
            'ndss': true, // for now
            'pets': true,
            'eurosys': true,
	    'eurographics': true,
            'fast': true,
            'usenixatc': true,
            'icfp': true,
            'oopsla': true,
	    'kdd': true,
        };

    public static readonly childMap: { [key: string]: [string] } = {};

    private static readonly noteMap: { [note: string]: string } =
        {
            'Tech': 'https://tech.cornell.edu/',
            'CBG': 'https://www.cis.mpg.de/cbg/',
            'INF': 'https://www.cis.mpg.de/mpi-inf/',
            'IS': 'https://www.cis.mpg.de/is/',
            'MG': 'https://www.cis.mpg.de/molgen/',
            'SP': 'https://www.cis.mpg.de/mpi-for-security-and-privacy/',
            'SWS': 'https://www.cis.mpg.de/mpi-sws/'
        };

    private readonly areaMap: Array<AreaMap>
        = [{ area: "ai", title: "AI" },
        { area: "aaai", title: "AI" },
        { area: "ijcai", title: "AI" },
        { area: "vision", title: "Vision" },
        { area: "cvpr", title: "Vision" },
        { area: "eccv", title: "Vision" },
        { area: "iccv", title: "Vision" },
        { area: "mlmining", title: "ML" },
        { area: "icml", title: "ML" },
        { area: "kdd", title: "ML" },
        { area: "iclr", title: "ML" },
        { area: "nips", title: "ML" },
        { area: "nlp", title: "NLP" },
        { area: "acl", title: "NLP" },
        { area: "emnlp", title: "NLP" },
        { area: "naacl", title: "NLP" },
        { area: "inforet", title: "Web+IR" },
        { area: "sigir", title: "Web+IR" },
        { area: "www", title: "Web+IR" },
        { area: "arch", title: "Arch" },
        { area: "asplos", title: "Arch" },
        { area: "isca", title: "Arch" },
        { area: "micro", title: "Arch" },
        { area: "hpca", title: "Arch" },
        { area: "comm", title: "Networks" },
        { area: "sigcomm", title: "Networks" },
        { area: "nsdi", title: "Networks" },
        { area: "sec", title: "Security" },
        { area: "ccs", title: "Security" },
        { area: "oakland", title: "Security" },
        { area: "usenixsec", title: "Security" },
        { area: "ndss", title: "Security" },
        { area: "pets", title: "Security" },
        { area: "mod", title: "DB" },
        { area: "sigmod", title: "DB" },
        { area: "vldb", title: "DB" },
        { area: "icde", title: "DB" }, // next tier
        { area: "pods", title: "DB" }, // next tier
        { area: "hpc", title: "HPC" },
        { area: "sc", title: "HPC" },
        { area: "hpdc", title: "HPC" },
        { area: "ics", title: "HPC" },
        { area: "mobile", title: "Mobile" },
        { area: "mobicom", title: "Mobile" },
        { area: "mobisys", title: "Mobile" },
        { area: "sensys", title: "Mobile" },
        { area: "metrics", title: "Metrics" },
        { area: "imc", title: "Metrics" },
        { area: "sigmetrics", title: "Metrics" },
        { area: "ops", title: "OS" },
        { area: "sosp", title: "OS" },
        { area: "osdi", title: "OS" },
        { area: "fast", title: "OS" },   // next tier
        { area: "usenixatc", title: "OS" },   // next tier
        { area: "eurosys", title: "OS" },
        { area: "pldi", title: "PL" },
        { area: "popl", title: "PL" },
        { area: "icfp", title: "PL" },   // next tier
        { area: "oopsla", title: "PL" }, // next tier
        { area: "plan", title: "PL" },
        { area: "soft", title: "SE" },
        { area: "fse", title: "SE" },
        { area: "icse", title: "SE" },
        { area: "ase", title: "SE" },    // next tier
        { area: "issta", title: "SE" },  // next tier
        { area: "act", title: "Theory" },
        { area: "focs", title: "Theory" },
        { area: "soda", title: "Theory" },
        { area: "stoc", title: "Theory" },
        { area: "crypt", title: "Crypto" },
        { area: "crypto", title: "Crypto" },
        { area: "eurocrypt", title: "Crypto" },
        { area: "log", title: "Logic" },
        { area: "cav", title: "Logic" },
        { area: "lics", title: "Logic" },
        { area: "graph", title: "Graphics" },
        { area: "siggraph", title: "Graphics" },
        { area: "siggraph-asia", title: "Graphics" },
        { area: "eurographics", title: "Graphics" },
        { area: "chi", title: "HCI" },
        { area: "chiconf", title: "HCI" },
        { area: "ubicomp", title: "HCI" },
        { area: "uist", title: "HCI" },
        { area: "robotics", title: "Robotics" },
        { area: "icra", title: "Robotics" },
        { area: "iros", title: "Robotics" },
        { area: "rss", title: "Robotics" },
        { area: "bio", title: "Comp. Bio" },
        { area: "ismb", title: "Comp. Bio" },
        { area: "recomb", title: "Comp. Bio" },
        { area: "da", title: "EDA" },
        { area: "dac", title: "EDA" },
        { area: "iccad", title: "EDA" },
        { area: "bed", title: "Embedded" },
        { area: "emsoft", title: "Embedded" },
        { area: "rtas", title: "Embedded" },
        { area: "rtss", title: "Embedded" },
        { area: "visualization", title: "Visualization" },
        { area: "vis", title: "Visualization" },
        { area: "vr", title: "Visualization" },
        { area: "ecom", title: "ECom" },
        { area: "ec", title: "ECom" },
        { area: "wine", title: "ECom" },
        { area : "csed", title : "CSEd" },
        { area : "sigcse", title: "CSEd" }
        ];

    private readonly aiAreas = ["ai", "vision", "mlmining", "nlp", "inforet"];
    private readonly systemsAreas = ["arch", "comm", "sec", "mod", "da", "bed", "hpc", "mobile", "metrics", "ops", "plan", "soft"];
    private readonly theoryAreas = ["act", "crypt", "log"];
    private readonly interdisciplinaryAreas = ["bio", "graph", "csed", "ecom", "chi", "robotics", "visualization"];

    private readonly areaNames: Array<string> = [];
    private readonly fields: Array<string> = [];
    private readonly aiFields: Array<number> = [];
    private readonly systemsFields: Array<number> = [];
    private readonly theoryFields: Array<number> = [];
    private readonly otherFields: Array<number> = [];

    /* Map area to its name (from areaNames). */
    private readonly areaDict: { [key: string]: string } = {};

    /* Map area to its position in the list. */
    private readonly areaPosition: { [key: string]: number } = {};

    /* Map subareas to their areas. */
    private readonly subareas: { [key: string]: string } = {};

    /* Map names to Google Scholar IDs. */
    private readonly scholarInfo: { [key: string]: string } = {};

    /* Map aliases to canonical author name. */
    private readonly aliases: { [key: string]: string } = {};

    /* Map Turing award winners to year */
    private readonly turing: { [key: string]: number } = {};

    /* Map ACM Fellow award winners to year */
    private readonly acmfellow: { [key: string]: number } = {};

    /* Map institution to region. */
    private readonly countryInfo: { [key: string]: string } = {};

    /* Map country codes (abbreviations) to names. */
    private readonly countryNames: { [key: string]: string } = {};

    /* Map institution to (non-US) abbreviation. */
    private readonly countryAbbrv: { [key: string]: string } = {};

    /* Map name to home page. */
    private readonly homepages: { [key: string]: string } = {};

    /* Set to true for "dense rankings" vs. "competition rankings". */
    private readonly useDenseRankings: boolean = false;

    /* The data which will hold the parsed CSV of author info. */
    private authors: Array<Author> = [];

    /* The DBLP-transformed strings per author. */
    private dblpAuthors: { [name: string]: string } = {};

    /* Map authors to the areas they have published in (for pie chart display). */
    private authorAreas: { [name: string]: { [area: string]: number } } = {};

    /* Computed stats (univagg). */
    private stats: { [key: string]: number } = {};

    private areaDeptAdjustedCount: { [key: string]: number } = {}; /* area+dept */

    private areaStringMap: { [key: string]: string } = {}; // name -> areaString (memoized)

    private usePieChart: boolean = false;

    /* Colors. */
    private readonly RightTriangle = "&#9658;";   // right-facing triangle symbol (collapsed view)
    private readonly DownTriangle = "&#9660;";   // downward-facing triangle symbol (expanded view)
    private readonly BarChartIcon = "<img class='closed_chart_icon chart_icon' alt='closed chart' src='png/barchart.png'>"; // bar chart image
    private readonly OpenBarChartIcon = "<img class='open_chart_icon chart_icon' alt='opened chart' src='png/barchart-open.png'>"; // opened bar chart image
    private readonly PieChartIcon = "<img class='closed_chart_icon chart_icon' alt='closed chart' src='png/piechart.png'>";
    private readonly OpenPieChartIcon = "<img class='open_chart_icon chart_icon' alt='opened chart' src='png/piechart-open.png'>";
    private ChartIcon = this.BarChartIcon;
    private OpenChartIcon = this.OpenBarChartIcon;

    private translateNameToDBLP(name: string): string {
	// Ex: "Emery D. Berger" -> "http://dblp.uni-trier.de/pers/hd/b/Berger:Emery_D="
	// First, replace spaces and non-ASCII characters (not complete).
	name = name.replace(/ Jr\./g, "_Jr.");
	name = name.replace(/ II/g, "_II");
	name = name.replace(/ III/g, "_III");
	name = name.replace(/'|\-|\./g, "=");
	// Now replace diacritics.
	name = he.encode(name, { 'useNamedReferences' : true, 'allowUnsafeSymbols' : true });
	name = name.replace(/&/g, "=");
	name = name.replace(/;/g, "=");
	
	let splitName = name.split(" ");
	let lastName = splitName[splitName.length - 1];
	let disambiguation = "";
	if (parseInt(lastName) > 0) {
            // this was a disambiguation entry; go back.
            disambiguation = lastName;
            splitName.pop();
            lastName = splitName[splitName.length - 1] + "_" + disambiguation;
	}
	splitName.pop();
	let newName = splitName.join(" ");
	newName = newName.replace(/\s/g, "_");
	newName = newName.replace(/\-/g, "=");
	newName = encodeURIComponent(newName);
	let str = "https://dblp.org/pers/hd";
	const lastInitial = lastName[0].toLowerCase();
	str += `/${lastInitial}/${lastName}:${newName}`;
	return str;
    }

    /* Create the prologue that we preface each generated HTML page with (the results). */
    private makePrologue(): string {
        const s = '<div class="table-responsive" style="overflow:auto; height:700px;">'
            + '<table class="table table-fit table-sm table-striped"'
            + 'id="ranking" valign="top">';
        return s;
    }

    private static sum(n: Array<number>): number {
        let s = 0.0;
        for (let i = 0; i < n.length; i++) {
            s += n[i];
        }
        return s;
    }

    private static average(n: Array<number>): number {
        return ProfRankings.sum(n) / n.length;
    }

    private static stddev(n: Array<number>): number {
        const avg = ProfRankings.average(n);
        const squareDiffs = n.map(function(value) {
            const diff = value - avg;
            return (diff * diff);
        });
        const sigma = Math.sqrt(ProfRankings.sum(squareDiffs) / (n.length - 1));
        return sigma;
    }

    private areaString(name: string): string {
        if (name in this.areaStringMap) {
            return this.areaStringMap[name];
        }
        // Create a summary of areas, separated by commas,
        // corresponding to a faculty member's publications.  We only
        // consider areas within a fixed number of standard deviations
        // of the max that also comprise a threshold fraction of pubs
        // (and at least crossing a min count threshold).
        const pubThreshold = 0.2;
        const numStddevs = 1.0;
        const topN = 3;
        const minPubThreshold = 1;
        if (!this.authorAreas[name]) {
            return "";
        }
        // Create an object containing areas and number of publications.
        // This is essentially duplicated logic from makeChart and
        // should be factored out.
        let datadict: { [key: string]: number } = {};
        const keys = ProfRankings.topTierAreas;
        let maxValue = 0;
        for (let key in keys) { // i = 0; i < keys.length; i++) {
            //	    let key = keys[i];
            //	    if (key in ProfRankings.nextTier) {
            //		continue;
            //	    }
            const value = this.authorAreas[name][key];
            if (key in ProfRankings.parentMap) {
                key = this.areaDict[key];
            }
            if (value > 0) {
                if (!(key in datadict)) {
                    datadict[key] = 0;
                }
                datadict[key] += value;
                maxValue = (datadict[key] > maxValue) ? datadict[key] : maxValue;
            }
        }
        // Now compute the standard deviation.
        let values: Array<number> = [];
        for (const key in datadict) {
            values.push(datadict[key]);
        }
        const sum = ProfRankings.sum(values);
        let stddevs = 0.0;
        if (values.length > 1) {
            stddevs = Math.ceil(numStddevs * ProfRankings.stddev(values));
        }
        // Strip out everything not within the desired number of
        // standard deviations of the max and not crossing the
        // publication threshold.
        let maxes: Array<string> = [];
        for (const key in datadict) {
            if ((datadict[key] >= maxValue - stddevs) &&
                ((1.0 * datadict[key]) / sum >= pubThreshold) &&
                (datadict[key] > minPubThreshold)) {
                maxes.push(key);
            }
        }
        // Finally, pick at most the top N.
        const areaList = maxes.sort((x, y) => { return datadict[y] - datadict[x]; }).slice(0, topN);
        // Cache the result.
        this.areaStringMap[name] = areaList.map(n => `<span class="${this.subareas[n]}-area">${n}</span>`).join(",");
        // Return it.
        return this.areaStringMap[name];
    }

    private removeDisambiguationSuffix(str: string) {
	// Matches a space followed by a four-digit number at the end of the string
	const regex = /\s\d{4}$/;
	return str.replace(regex, '');
    }

    /* from http://hubrik.com/2015/11/16/sort-by-last-name-with-javascript/ */
    private compareNames(a: string, b: string): number {

        // Split the names as strings into arrays,
	// removing any disambiguation suffixes first.
	
        const aName = this.removeDisambiguationSuffix(a).split(" ");
        const bName = this.removeDisambiguationSuffix(b).split(" ");

        // get the last names by selecting
        // the last element in the name arrays
        // using array.length - 1 since full names
        // may also have a middle name or initial
        const aLastName = aName[aName.length - 1];
        const bLastName = bName[bName.length - 1];

	let returnValue : number;
	
        // compare the names and return either
        // a negative number, positive number
        // or zero.
        if (aLastName < bLastName) {
	    returnValue = -1;
	} else if (aLastName > bLastName) {
	    returnValue = 1;
	} else {
	    returnValue = 0;
	}
	
        return returnValue;
    }

    /* Create a bar or pie chart using Vega. Modified by Minsuk Kahng (https://minsuk.com) */
    private makeChart(name: string, isPieChart: boolean): void {
        let data: Array<ChartData> = [];
        let datadict: { [key: string]: number } = {};
        const keys = ProfRankings.topTierAreas;
        const uname = unescape(name);

        // Areas with their category info for color map (from https://colorbrewer2.org/#type=qualitative&scheme=Set1&n=4).
        const areas = [
            ...this.aiAreas.map(key =>
                ({key: key, label: this.areaDict[key], color: "#377eb8"})),
            ...this.systemsAreas.map(key =>
                ({key: key, label: this.areaDict[key], color: "#ff7f00"})),
            ...this.theoryAreas.map(key =>
                ({key: key, label: this.areaDict[key], color: "#4daf4a"})),
            ...this.interdisciplinaryAreas.map(key =>
                ({key: key, label: this.areaDict[key], color: "#984ea3"}))
        ];
        areas.forEach(area => datadict[area.key] = 0);

        for (let key in keys) { // i = 0; i < keys.length; i++) {
            //	    let key = keys[i];
            if (!(uname in this.authorAreas)) {
                // Defensive programming.
                // This should only happen if we have an error in the aliases file.
                return;
            }
            //	    if (key in ProfRankings.nextTier) {
            //		continue;
            //	    }
            // Round it to the nearest 0.1.
            const value = Math.round(this.authorAreas[uname][key] * 10) / 10;

            // Use adjusted count if this is for a department.
            /*
              DISABLED so department charts are invariant.
              
              if (uname in this.stats) {
              value = this.areaDeptAdjustedCount[key+uname] + 1;
              if (value == 1) {
              value = 0;
              }
              }
            */
            if (value > 0) {
                if (key in ProfRankings.parentMap) {
                    key = ProfRankings.parentMap[key];
                }
                datadict[key] += value;
            }
        }

        let valueSum = 0;
        areas.forEach(area => {
            valueSum += datadict[area.key];
        });
        areas.forEach((area, index) => {
            const newSlice = {
                index: index,
                area: this.areaDict[area.key],
                value: Math.round(datadict[area.key] * 10) / 10,
                ratio: datadict[area.key] / valueSum
            };
            data.push(newSlice);

            area.label = this.areaDict[area.key];
        });

        const colors = areas.sort((a, b) => 
            a.label > b.label ? 1 : (a.label < b.label ? -1 : 0)
            ).map(area => area.color);

        const vegaLiteBarChartSpec = {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            data: {
                values: data
            },
            mark: "bar",
            encoding: {
                x: {
                    field: "area",
                    type: "nominal",
                    sort: null,
                    axis: {title: null}
                },
                y: {
                    field: "value",
                    type: "quantitative",
                    axis: {title: null}
                },
                tooltip: [
                    {"field": "area", "type": "nominal", "title": "Area"},
                    {"field": "value", "type": "quantitative", "title": "Count"}
                ],
                color: {
                    field: "area",
                    type: "nominal",
                    scale: {"range": colors},
                    legend: null
                }
            },
            width: 420,
            height: 80,
            padding: {left: 25, top: 3}
        };

        const vegaLitePieChartSpec = {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            data: {
                values: data
            },
            encoding: {
                theta: {
                    field: "value",
                    type: "quantitative",
                    stack: true
                },
                color: {
                    field: "area",
                    type: "nominal",
                    scale: {"range": colors},
                    legend: null
                },
                order: {field: "index"},
                tooltip: [
                    {field: "area", type: "nominal", title: "Area"},
                    {field: "value", type: "quantitative", title: "Count"},
                    {field: "ratio", type: "quantitative", title: "Ratio", format: ".1%"}
                ]
            },
            layer: [
                {
                    mark: {type: "arc", outerRadius: 90, stroke: "#fdfdfd", strokeWidth: 1}
                },
                {
                    mark: {type: "text", radius: 108, dy: -3},
                    encoding: {
                        text: {field: "area", type: "nominal"},
                        color: {
                            condition: {test: "datum.ratio < 0.03", value: "rgba(255, 255, 255, 0)"},
                            field: "area",
                            type: "nominal",
                            scale: {"range": colors}
                        }
                    }
                },
                {
                    mark: {type: "text", radius: 108, fontSize: 9, dy: 7},
                    encoding: {
                        text: {field: "value", type: "quantitative"},
                        color: {
                            condition: {test: "datum.ratio < 0.03", value: "rgba(255, 255, 255, 0)"},
                            field: "area",
                            type: "nominal",
                            scale: {"range": colors}
                        }
                    }
                }
            ],
            width: 400,
            height: 250,
            padding: {left: 25, top: 3}
        };
        
        vegaEmbed(`div[id="${name}-chart"]`, 
            isPieChart ? vegaLitePieChartSpec : vegaLiteBarChartSpec,
            {actions: false}
        );
    }

    private displayProgress(step: number) {
        const msgs = ["Initializing.",
            "Loading author information.",
            "Loading publication data.",
            "Computing ranking."];
	const s = `<strong>${msgs[step-1]}</strong><br />`;
        const progress = document.querySelector("#progress");
	if (progress) {
	   progress!.innerHTML = s;
	}
    }

    private async loadTuring(turing: { [key: string]: number }): Promise<void> {
        const data = await new Promise((resolve) => {
            Papa.parse(this.turingFile, {
                header: true,
                download: true,
                complete: (results) => {
                    resolve(results.data);
                }
            });
        });
        const d = data as Array<Turing>;
        for (const turingPair of d) {
            turing[turingPair.name] = turingPair.year;
        }
    }

    private async loadACMFellow(acmfellow: { [key: string]: number }): Promise<void> {
        const data = await new Promise((resolve) => {
            Papa.parse(this.acmfellowFile, {
                header: true,
                download: true,
                complete: (results) => {
                    resolve(results.data);
                }
            });
        });
        const d = data as Array<ACMFellow>;
        for (const acmfellowPair of d) {
            acmfellow[acmfellowPair.name] = acmfellowPair.year;
        }
    }

    private async loadCountryInfo(countryInfo: { [key: string]: string },
        countryAbbrv: { [key: string]: string }): Promise<void> {
        const data = await new Promise((resolve) => {
            Papa.parse(this.countryinfoFile, {
                header: true,
                download: true,
                complete: (results) => {
                    resolve(results.data);
                }
            });
        });
        const ci = data as Array<CountryInfo>;
        for (const info of ci) {
            countryInfo[info.institution] = info.region;
            countryAbbrv[info.institution] = info.countryabbrv;
        }
    }

    private async loadCountryNames(countryNames: { [key: string]: string }): Promise<void> {
        const data = await new Promise((resolve) => {
            Papa.parse(this.countrynamesFile, {
                header: true,
                download: true,
                complete: (results) => {
                    resolve(results.data);
                }
            });
        });
        const ci = data as Array<CountryName>;
        for (const info of ci) {
            countryNames[info.alpha_2] = info.name;
        }
    }

    private async loadAuthorInfo(): Promise<void> {
        const data = await new Promise((resolve) => {
            Papa.parse(this.authorFile, {
                download: true,
                header: true,
                complete: (results) => {
                    resolve(results.data);
                }
            });
        });
        const ai = data as Array<AuthorInfo>;
        for (let counter = 0; counter < ai.length; counter++) {
            const record = ai[counter];
            let name = record['name'].trim();
            const result = name.match(ProfRankings.nameMatcher);
            if (result) {
                name = result[1].trim();
                this.note[name] = result[2];
            }
            if (name !== "") {
                this.dblpAuthors[name] = this.translateNameToDBLP(name);
                this.homepages[name] = record['homepage'];
                this.scholarInfo[name] = record['scholarid'];
            }
        }
    }

    private async loadAuthors(): Promise<void> {
        const data = await new Promise((resolve) => {
            Papa.parse(this.authorinfoFile, {
                download: true,
                header: true,
                complete: (results) => {
                    resolve(results.data);
                }
            });
        });
        this.authors = data as Array<Author>;
    }

    private inRegion(dept: string,
		     regions: string): boolean {
        switch (regions) {
            case "northamerica":
                if (this.countryInfo[dept] != "northamerica") {
                    return false;
                }
                break;
            case "europe":
                if (this.countryInfo[dept] != "europe") {
                    return false;
                }
                break;
            case "australasia":
                if (this.countryInfo[dept] != "australasia") {
                    return false;
                }
                break;
            case "southamerica":
                if (this.countryInfo[dept] != "southamerica") {
                    return false;
                }
                break;
            case "asia":
                if (this.countryInfo[dept] != "asia") {
                    return false;
                }
                break;
            case "africa":
                if (this.countryInfo[dept] != "africa") {
                    return false;
                }
                break;
            case "world":
                break;
default:
                if (this.countryAbbrv[dept] != regions) {
                    return false;
                }
                break;
        }
        return true;
    }

    private activateFields(value: boolean,
        fields: Array<number>): boolean {
        for (let i = 0; i < fields.length; i++) {
            const item = this.fields[fields[i]];
            const str = `input[name=${item}]`;
            $(str).prop('checked', value);
            if (item in ProfRankings.childMap) {
                // It's a parent.
                $(str).prop('disabled', false);
                // Activate / deactivate all children as appropriate.
                ProfRankings.childMap[item].forEach((k) => {
                    const str = `input[name=${k}]`;
                    if (k in ProfRankings.nextTier) {
                        $(str).prop('checked', false);
                    } else {
                        $(str).prop('checked', value);
                    }
                });
            }
        }
        this.rank();
        return false;
    }

    private sortIndex(univagg: { [key: string]: number }): string[] {
        let keys = Object.keys(univagg);
        keys.sort((a, b) => {
            if (univagg[a] != univagg[b]) {
                return univagg[b] - univagg[a];
            }
            /*
              if (univagg[a] > univagg[b]) {
              return -1;
              }
              if (univagg[b] > univagg[a]) {
              return 1;
              }
            */
            if (a < b) {
                return -1;
            }
            if (b < a) {
                return 1;
            }
            return 0;
        });
        return keys;
    }

    private countAuthorAreas(): void {
        const startyear = parseInt($("#fromyear").find(":selected").text());
        const endyear = parseInt($("#toyear").find(":selected").text());
        this.authorAreas = {};
        for (const r in this.authors) {
            const { area } = this.authors[r];
            if (area in ProfRankings.nextTier) {
                continue;
            }
            const { year } = this.authors[r];
            if ((year < startyear) || (year > endyear)) {
                continue;
            }
            const { name, dept, count } = this.authors[r];
            /*
              DISABLING weight selection so all pie charts look the
              same regardless of which areas are currently selected:
              
              if (weights[theArea] === 0) {
              continue;
              }
            */
            const theCount = parseFloat(count);
            if (!(name in this.authorAreas)) {
                this.authorAreas[name] = {};
                for (const area in this.areaDict) {
                    if (this.areaDict.hasOwnProperty(area)) {
                        this.authorAreas[name][area] = 0;
                    }
                }
            }
            if (!(dept in this.authorAreas)) {
                this.authorAreas[dept] = {};
                for (const area in this.areaDict) {
                    if (this.areaDict.hasOwnProperty(area)) {
                        this.authorAreas[dept][area] = 0;
                    }
                }
            }
            this.authorAreas[name][area] += theCount;
            this.authorAreas[dept][area] += theCount;
        }
    }

    private buildFaculty(startyear: number,
        endyear: number,
        weights: { [key: string]: number },
        regions: string,
        facultycount: { [key: string]: number },
        facultyAdjustedCount: { [key: string]: number }): void {
        /* contains an author name if that author has been processed. */
        const visited: { [key: string]: boolean } = {};
        for (const r in this.authors) {
            if (!this.authors.hasOwnProperty(r)) {
                continue;
            }
            const auth = this.authors[r];
            const dept = auth.dept;
            //	    if (!(dept in regionMap)) {
            if (!this.inRegion(dept, regions)) {
                continue;
            }
            let area = auth.area;
            if (weights[area] === 0) {
                continue;
            }
            const year = auth.year;
            if ((year < startyear) || (year > endyear)) {
                continue;
            }
            if (typeof dept === 'undefined') {
                continue;
            }
            const name = auth.name;
            // If this area is a child area, accumulate totals for parent.
            if (area in ProfRankings.parentMap) {
                area = ProfRankings.parentMap[area];
            }
            const areaDept: string = area + dept;
            if (!(areaDept in this.areaDeptAdjustedCount)) {
                this.areaDeptAdjustedCount[areaDept] = 0;
            }
            const count: number = parseInt(this.authors[r].count);
            const adjustedCount: number = parseFloat(this.authors[r].adjustedcount);
            this.areaDeptAdjustedCount[areaDept] += adjustedCount;
            /* Is this the first time we have seen this person? */
            if (!(name in visited)) {
                visited[name] = true;
                facultycount[name] = 0;
                facultyAdjustedCount[name] = 0;
            }
            facultycount[name] += count;
            facultyAdjustedCount[name] += adjustedCount;
        }
    }

    private computeStats(facultyAdjustedCount: { [key: string]: number },
        weights: { [key: string]: number },
        regions: string,
        startyear: number,
        endyear: number) {
        this.stats = {};
	for (const r in this.authors) {
	    if (!this.authors.hasOwnProperty(r)) {
		continue;
	    }
	    const auth = this.authors[r];
	    const name = auth.name;
	    if (name in this.stats) {
		// Already processed.
		continue;
	    }
            if (!this.inRegion(auth.dept, regions)) {
                continue;
            }
            const year = auth.year;
            if ((year < startyear) || (year > endyear)) {
                continue;
            }
	    let area = auth.area;
            if (weights[area] === 0) {
                continue;
            }
	    this.stats[name] = facultyAdjustedCount[name];
	}
    }

    /* Updates the 'weights' of each area from the checkboxes. */
    /* Returns the number of areas selected (checked). */
    private updateWeights(weights: { [key: string]: number }): number {
        let numAreas = 0;
        for (let ind = 0; ind < ProfRankings.areas.length; ind++) {
            const area = ProfRankings.areas[ind];
            weights[area] = $(`input[name=${this.fields[ind]}]`)
.prop('checked') ? 1 : 0;
            if (weights[area] === 1) {
                if (area in ProfRankings.parentMap) {
                    // Don't count children.
                    continue;
                }
                /* One more area checked. */
                numAreas++;
            }
        }
        return numAreas;
    }

    private buildOutputString(numAreas: number,
        facultycount: { [key: string]: number },
        minToRank: number): string {
        let s = this.makePrologue();
        /* Show the top N (with more if tied at the end) */

        s = s + '<thead><tr><th align="left"><font color="#777">#</font></th><th align="left"><font color="#777">Professor</font>'
            + '&nbsp;'.repeat(20)
            + '</th><th align="right">'
            + '<abbr title="Total number of publications."><font color="#777">Count</font>'
            + '</abbr></th><th align="right">&nbsp;<abbr title="Adjusted count of publications."><font color="#777">Adj. Count</font>'
            + '</abbr></th></tr></thead>';

        s = s + "<tbody>";
        /* As long as there is at least one thing selected, compute and display a ranking. */
        if (numAreas > 0) {
            let ties = 1;               /* number of tied entries so far (1 = no tie yet); used to implement "competition rankings" */
            let rank = 0;               /* index */
            let oldv = 9999999.999;     /* old number - to track ties */
            /* Sort the university aggregate count from largest to smallest. */
            // First, round the stats.
            for (const k in this.stats) {
                const v = Math.round(10.0 * this.stats[k]) / 10.0;
                this.stats[k] = v;
            }
            // Now sort them,
            const keys2 = this.sortIndex(this.stats);
            /* Display rankings until we have shown `minToRank` items or
               while there is a tie (those all get the same rank). */
            for (let ind = 0; ind < keys2.length; ind++) {
                const name = keys2[ind];
                const v = this.stats[name];

                if ((ind >= minToRank) && (v != oldv)) {
                    break;
                }
                if (v === 0.0) {
                    break;
                }
                if (oldv != v) {
                    if (this.useDenseRankings) {
                        rank = rank + 1;
                    } else {
                        rank = rank + ties;
                        ties = 0;
                    }
                }
                const esc = escape(name);
                s += "\n<tr><td>" + rank;
                // Print spaces to hold up to 4 digits of ranked schools.
		if (rank > 0) {
                    s += "&nbsp;".repeat(4 - Math.ceil(Math.log10(rank)));
		}
                s += "</td>";
                s += "<td>"
                    + `<a title=\"Click for author's home page.\" target=\"_blank\" href="${this.homepages[name]}" `
                    + `onclick="trackOutboundLink('${this.homepages[name]}', true); return false;">`
                    + `${this.removeDisambiguationSuffix(name)}</a>&nbsp;`;
                s += `<span onclick='profs.toggleChart("${esc}"); ga("send", "event", "chart", "toggle", "toggle ${esc} ${$("#charttype").find(":selected").val()} chart");' title="Click for author's publication profile." class="hovertip" id="${esc}-chartwidget">`
                    + this.ChartIcon + "</span>";
                s += "</td>";

                s += `<td align="right">${facultycount[name]}</td>`;
                s += `<td align="right">${(Math.round(10.0 * v) / 10.0).toFixed(1)}</td>`;
                s += "</tr>\n";
                s += `<tr><td colspan="4"><div class="csr-chart" id="${esc}-chart"></div></td></tr>`;
                ties++;
                oldv = v;
            }
            s += "</tbody></table><br/>";
            s += "</div></div>\n";
            s += "<br></body></html>";
        } else {
            /* Nothing selected. */
            s = "<h3>Please select at least one area by clicking one or more checkboxes.</h3>";
        }
        return s;
    }

    /* This activates all checkboxes _without_ triggering ranking. */
    private setAllOn(value: boolean = true): void {
        for (let i = 0; i < ProfRankings.areas.length; i++) {
            const item = this.fields[i];
            const str = `input[name=${item}]`;
            if (value) {
                // Turn off all next tier venues.
                if (item in ProfRankings.nextTier) {
                    $(str).prop('checked', false);
                } else {
                    $(str).prop('checked', true);
                    $(str).prop('disabled', false);
                }
            } else {
                // turn everything off.
                $(str).prop('checked', false);
                $(str).prop('disabled', false);
            }
        }
    }

    /* PUBLIC METHODS */

    public rank(update: boolean = true): boolean {

        const start = performance.now();

        let facultycount: { [key: string]: number } = {};         /* name -> raw count of pubs per name / department */
        let facultyAdjustedCount: { [key: string]: number } = {}; /* name -> adjusted count of pubs per name / department */
        let currentWeights: { [key: string]: number } = {};       /* array to hold 1 or 0, depending on if the area is checked or not. */
        this.areaDeptAdjustedCount = {};

        const startyear = parseInt($("#fromyear").find(":selected").text());
        const endyear = parseInt($("#toyear").find(":selected").text());
        const whichRegions = String($("#regions").find(":selected").val());

        const numAreas = this.updateWeights(currentWeights);

        this.buildFaculty(startyear,
            endyear,
            currentWeights,
            whichRegions,
            facultycount,
            facultyAdjustedCount);

        /* (university, total or average number of papers) */
        this.computeStats(facultyAdjustedCount,
            currentWeights,
            whichRegions,
            startyear,
            endyear);

        /* Start building up the string to output. */
        const s = this.buildOutputString(numAreas,
            facultycount,
            ProfRankings.minToRank);

        let stop = performance.now();
        console.log(`Before render: rank took ${(stop - start)} milliseconds.`);

        /* Finally done. Redraw! */
        document.getElementById("success")!.innerHTML = s;
        $("div").scroll(function() {
            // console.log("scrollTop = " + this.scrollTop + ", clientHeight = " + this.clientHeight + ", scrollHeight = " + this.scrollHeight);
            // If we are nearly at the bottom, update the minimum.
            if (this.scrollTop + this.clientHeight > this.scrollHeight - 50) {
                const t = ProfRankings.updateMinimum(this);
                if (t) {
                    $("div").scrollTop(t);
                }
            }
        });

        if (!update) {
            this.navigoRouter.pause();
        } else {
            this.navigoRouter.resume();
        }
        const str = this.updatedURL();

        this.navigoRouter.navigate(str);

	stop = performance.now();
        console.log(`Rank took ${(stop - start)} milliseconds.`);

        return false;
    }

    /* Turn the chart display on or off. */
    public toggleChart(name: string): void {
        const chart = document.getElementById(name + "-chart");
        const chartwidget = document.getElementById(name + "-chartwidget");
        if (chart!.style.display === 'block') {
            chart!.style.display = 'none';
            chart!.innerHTML = '';
            chartwidget!.innerHTML = this.ChartIcon;
        } else {
            chart!.style.display = 'block';
            this.makeChart(name, this.usePieChart);
            chartwidget!.innerHTML = this.OpenChartIcon;
        }

    }

    /* Expand or collape the view of conferences in a given area. */
    public toggleConferences(area: string): void {
        const e = document.getElementById(area + "-conferences");
        const widget = document.getElementById(area + "-widget");
        if (e!.style.display === 'block') {
            e!.style.display = 'none';
            widget!.innerHTML = this.RightTriangle;
        } else {
            e!.style.display = 'block';
            widget!.innerHTML = this.DownTriangle;
        }
    }


    public activateAll(value: boolean = true): boolean {
        this.setAllOn(value);
        this.rank();
        return false;
    }

    public activateNone(): boolean {
        return this.activateAll(false);
    }

    public activateSystems(value: boolean = true): boolean {
        return this.activateFields(value, this.systemsFields);
    }

    public activateAI(value: boolean = true): boolean {
        return this.activateFields(value, this.aiFields);
    }

    public activateTheory(value: boolean = true): boolean {
        return this.activateFields(value, this.theoryFields);
    }

    public activateOthers(value: boolean = true): boolean {
        return this.activateFields(value, this.otherFields);
    }

    public deactivateSystems(): boolean {
        return this.activateSystems(false);
    }

    public deactivateAI(): boolean {
        return this.activateAI(false);
    }

    public deactivateTheory(): boolean {
        return this.activateTheory(false);
    }

    public deactivateOthers(): boolean {
        return this.activateOthers(false);
    }

    // Update the URL according to the selected checkboxes.
    private updatedURL(): string {
        let s = '';
        let count = 0;
        let totalParents = 0;
        for (let i = 0; i < this.fields.length; i++) {
            const str = `input[name=${this.fields[i]}]`;
            if (!(this.fields[i] in ProfRankings.parentMap)) {
                totalParents += 1;
            }
            if ($(str).prop('checked')) {
                // Only add parents.
                if (!(this.fields[i] in ProfRankings.parentMap)) {
                    // And only add if every top tier child is checked
                    // and only if every next tier child is NOT
                    // checked.
                    let allChecked = 1;
                    if (this.fields[i] in ProfRankings.childMap) {
                        ProfRankings.childMap[this.fields[i]].forEach((k) => {
                            let val = $(`input[name=${k}]`).prop('checked');
                            if (!(k in ProfRankings.nextTier)) {
                                allChecked &= val;
                            } else {
                                allChecked &= val ? 0 : 1;
                            }
                        });
                    }
                    if (allChecked) {
                        s += `${this.fields[i]}&`;
                        count += 1;
                    }
                }
            }
        }
        if (count > 0) {
            // Trim off the trailing '&'.
            s = s.slice(0, -1);
        }
        const region = $("#regions").find(":selected").val();
        let start = '';
        // Check the dates.
        const d = new Date();
        const currYear = d.getFullYear();
        const startyear = parseInt($("#fromyear").find(":selected").text());
        const endyear = parseInt($("#toyear").find(":selected").text());
        if ((startyear != currYear - 10) || (endyear != currYear)) {
            start += `/fromyear/${startyear.toString()}`;
            start += `/toyear/${endyear.toString()}`;
        }
        
        if (count == totalParents) {
            start += '/index?all'; // Distinguished special URL - default = all selected.
        } else if (count == 0) {
            start += '/index?none'; // Distinguished special URL - none selected.
        } else {
            start += `/index?${s}`;
        }
        if (region != "USA") {
            start += `&${region}`;
        }
        
        const chartType = $("#charttype").find(":selected").val();
        if (chartType == "pie") {
            this.usePieChart = true;
	    for (const elt of document.getElementsByClassName("chart_icon")) {
	      (<HTMLInputElement>elt).src = "png/piechart.png";
	    }
	    for (const elt of document.getElementsByClassName("open_chart_icon")) {
	      (<HTMLInputElement>elt).src = "png/piechart-open.png";
	    }
	    for (const elt of document.getElementsByClassName("closed_chart_icon")) {
	      (<HTMLInputElement>elt).src = "png/piechart.png";
	    }
	    this.ChartIcon = this.PieChartIcon;
	    this.OpenChartIcon = this.OpenPieChartIcon;
            start += '&pie';
        } else {
            this.usePieChart = false;
	    for (const elt of document.getElementsByClassName("chart_icon")) {
	      (<HTMLInputElement>elt).src = "png/barchart.png";
	    }
	    for (const elt of document.getElementsByClassName("open_chart_icon")) {
	      (<HTMLInputElement>elt).src = "png/barchart-open.png";
	    }
	    for (const elt of document.getElementsByClassName("closed_chart_icon")) {
	      (<HTMLInputElement>elt).src = "png/barchart.png";
	    }
	    this.ChartIcon = this.BarChartIcon;
	    this.OpenChartIcon = this.OpenBarChartIcon;
        }
        
        return start;
    }

    public static geoCheck(): void {
        navigator.geolocation?.getCurrentPosition((position) => {
            const continent = whichContinent(position.coords.latitude, position.coords.longitude);
            let regions = (<HTMLInputElement>document.getElementById("regions"));
            switch (continent) {
                case "northamerica":
                    return;
                case "europe":
                case "asia":
                case "southamerica":
                case "africa":
                    regions!.value = continent;
                    break;
                default:
                    regions!.value = "world";
                    break;
            }
            ProfRankings.getInstance().rank();
        });
    }

    /*
      public static geoCheck(): void {
      // Figure out which country clients are coming from and set
      // the default region accordingly.
      let theUrl = 'https://geoip-db.com/jsonp/'; // 'http://freegeoip.net/json/';
      $.getJSON(theUrl, (result) => {
      switch (result.country_code) {
      case "US":
      case "CN":
      case "IN":
      case "KR":
      case "JP":
      case "TW":
      case "SG":
      $("#regions").val("USA");
      ProfRankings.getInstance().rank();
      break;
      default:
      $("#regions").val("world");
      ProfRankings.getInstance().rank();
      break;
      }
      }).fail(() => {
      // If we can't find a location (e.g., because this site is
      // blocked by an ad blocker), just rank anyway.
      ProfRankings.getInstance().rank();
      });
      }
    */

    public navigation(params: { [key: string]: string }, query: string): void {
        if (params !== null) {
            // Set params (fromyear and toyear).
            Object.keys(params).forEach((key) => {
                $(`#${key}`).prop('value', params[key].toString());
            });
        }
        // Clear everything *unless* there are subsets / below-the-fold selected.
        ProfRankings.clearNonSubsetted();
        // Now check everything listed in the query string.
        let q = query.split('&');
        // If there is an 'all' in the query string, set everything to true.
        const foundAll = q.some((elem) => {
            return (elem == "all");
        });
	// For testing: if 'survey' is in the query string, reveal the survey overlay.
	const foundSurvey = q.some((elem) => {
	    return (elem == "survey");
	});
	if (foundSurvey) {
	    document!.getElementById("overlay-survey")!.style.display = "block";
	}
        const foundNone = q.some((elem) => {
            return (elem == "none");
        });
        // Check for regions and strip them out.
        const foundRegion = q.some((elem) => {
            return ProfRankings.regions.indexOf(elem) >= 0;
        });
        if (foundRegion) {
            let index = 0;
            q.forEach((elem) => {
                // Splice it out.
                if (ProfRankings.regions.indexOf(elem) >= 0) {
                    q.splice(index, 1);
                    // Set the region.
		    $("#regions").val(elem);
                }
                index += 1;
            });
        }
        // Check for pie chart
        const foundPie = q.some((elem) => {
            return (elem == "pie");
        });
        if (foundPie) {
            $("#charttype").val("pie");
        }
        
        if (foundAll) {
            // Set everything.
            for (const item in ProfRankings.topTierAreas) {
                //		if (!(item in ProfRankings.nextTier)) {
                let str = `input[name=${item}]`;
                $(str).prop('checked', true);
                if (item in ProfRankings.childMap) {
                    // It's a parent. Enable it.
                    $(str).prop('disabled', false);
                    // and activate all children.
                    ProfRankings.childMap[item].forEach((k) => {
                        if (!(k in ProfRankings.nextTier)) {
                            $(`input[name=${k}]`).prop('checked', true);
                        }
                    });
                }
                //		}
            }
            // And we're out.
            return;
        }
        if (foundNone) {
            // Clear everything and return.
            ProfRankings.clearNonSubsetted();
            return;
        }
        // Just a list of areas.
        // First, clear everything that isn't subsetted.
        ProfRankings.clearNonSubsetted();
        // Then, activate the areas in the query.
        for (const item of q) {
            if ((item != "none") && (item != "")) {
                const str = `input[name=${item}]`;
                $(str).prop('checked', true);
                $(str).prop('disabled', false);
                if (item in ProfRankings.childMap) {
                    // Activate all children.
                    ProfRankings.childMap[item].forEach((k) => {
                        if (!(k in ProfRankings.nextTier)) {
                            $(`input[name=${k}]`).prop('checked', true);
                        }
                    });
                }
            }
        }
    }

    public static clearNonSubsetted(): void {
        for (const item of ProfRankings.areas) {
            if (item in ProfRankings.childMap) {
                const kids = ProfRankings.childMap[item];
                if (!ProfRankings.subsetting(kids)) {
                    const str = `input[name=${item}]`;
                    $(str).prop('checked', false);
                    $(str).prop('disabled', false);
                    kids.forEach((item) => {
                        $(`input[name=${item}]`).prop('checked', false);
                    });
                }
            }
        }
    }

    public static subsetting(sibs: [string]): boolean {
        // Separate the siblings into above and below the fold.
        let aboveFold: string[] = [];
        let belowFold: string[] = [];
        sibs.forEach((elem) => {
            if (elem in ProfRankings.nextTier) {
                belowFold.push(elem);
            } else {
                aboveFold.push(elem);
            }
        });
        // Count how many are checked above and below.
        let numCheckedAbove = 0;
        aboveFold.forEach((elem) => {
            let str = `input[name=${elem}]`;
            let val = $(str).prop('checked');
            if (val) {
                numCheckedAbove++;
            }
        });
        let numCheckedBelow = 0;
        belowFold.forEach((elem) => {
            let str = `input[name=${elem}]`;
            let val = $(str).prop('checked');
            if (val) {
                numCheckedBelow++;
            }
        });
        const subsettedAbove = ((numCheckedAbove > 0) && (numCheckedAbove < aboveFold.length));
        const subsettedBelow = ((numCheckedBelow > 0) && (belowFold.length != 0));
        return subsettedAbove || subsettedBelow;
    }

    private addListeners(): void {
        ["toyear", "fromyear", "regions", "charttype"].forEach((key) => {
            const widget = document.getElementById(key);
            widget!.addEventListener("change", () => { this.countAuthorAreas(); this.rank(); });
        });
        // Add listeners for clicks on area widgets (left side of screen)
        // e.g., 'ai'
        for (let position = 0; position < ProfRankings.areas.length; position++) {
            let area = ProfRankings.areas[position];
            if (!(area in ProfRankings.parentMap)) {
                // Not a child.
                const widget = document.getElementById(`${area}-widget`);
                if (widget) {
                    widget!.addEventListener("click", () => {
                        this.toggleConferences(area);
                    });
                }
            }
        }
        // Initialize callbacks for area checkboxes.
        for (let i = 0; i < this.fields.length; i++) {
            const str = `input[name=${this.fields[i]}]`;
            const field = this.fields[i];
            const fieldElement = document.getElementById(this.fields[i]);
            if (!fieldElement) {
                continue;
            }
            fieldElement!.addEventListener("click", () => {
                let updateURL: boolean = true;
                if (field in ProfRankings.parentMap) {
                    // Child:
                    // If any child is on, activate the parent.
                    // If all are off, deactivate parent.
                    updateURL = false;
                    let parent = ProfRankings.parentMap[field];
                    const strparent = `input[name=${parent}]`;
                    let anyChecked = 0;
                    let allChecked = 1;
                    ProfRankings.childMap[parent].forEach((k) => {
                        const val = $(`input[name=${k}]`).prop('checked');
                        anyChecked |= val;
                        // allChecked means all top tier conferences
                        // are on and all next tier conferences are
                        // off.
                        if (!(k in ProfRankings.nextTier)) {
                            // All need to be on.
                            allChecked &= val;
                        } else {
                            // All need to be off.
                            allChecked &= val ? 0 : 1;
                        }
                    });
                    // Activate parent if any checked.
                    $(strparent).prop('checked', anyChecked);
                    // Mark the parent as disabled unless all are checked.
                    if (!anyChecked || allChecked) {
                        $(strparent).prop('disabled', false);
                    }
                    if (anyChecked && !allChecked) {
                        $(strparent).prop('disabled', true);
                    }
                } else {
                    // Parent: activate or deactivate all children.
                    const val = $(str).prop('checked');
                    if (field in ProfRankings.childMap) {
                        for (const child of ProfRankings.childMap[field]) {
                            const strchild = `input[name=${child}]`;
                            if (!(child in ProfRankings.nextTier)) {
                                $(strchild).prop('checked', val);
                            } else {
                                // Always deactivate next tier conferences.
                                $(strchild).prop('checked', false);
                            }
                        }
                    }
                }
                this.rank(updateURL);
            });
        }

	["#all_areas_on", "#ai_areas_on", "#systems_areas_on", "#theory_areas_on", "#other_areas_on"].forEach(sel => {
	    $(sel).on('click', () => {
		let area_on_id = sel.split("_")[0].substring(1);
		switch (area_on_id) {
		case "ai": this.activateAI(true); break;
		case "systems": this.activateSystems(true); break;
		case "theory": this.activateTheory(true); break;
		case "other": this.activateOthers(true); break;
		case "all": this.activateAll(true); break;
		}
	    });
	});

	["#all_areas_off", "#ai_areas_off", "#systems_areas_off", "#theory_areas_off", "#other_areas_off"].forEach(sel => {
	    $(sel).on('click', () => {
		let area_off_id = sel.split("_")[0].substring(1);
		switch (area_off_id) {
		case "ai": this.deactivateAI(); break;
		case "systems": this.deactivateSystems(); break;
		case "theory": this.deactivateTheory(); break;
		case "other": this.deactivateOthers(); break;
		case "all": this.activateNone(); break;
		}
	    });
	});
	
    }

}
new ProfRankings();
let profs = ProfRankings.getInstance();