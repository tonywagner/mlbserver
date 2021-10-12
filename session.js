#!/usr/bin/env node

// session.js defines the session class which handles API activity

// Required Node packages for the session class
const fs = require('fs')
const path = require('path')
const readlineSync = require('readline-sync')
const FileCookieStore = require('tough-cookie-filestore')
const parseString = require('xml2js').parseString

// Define some file paths and names
const DATA_DIRECTORY = path.join(__dirname, 'data')
const CACHE_DIRECTORY = path.join(__dirname, 'cache')
const MULTIVIEW_DIRECTORY_NAME = 'multiview'

const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json')
const PROTECTION_FILE = path.join(__dirname, 'protection.json')
const COOKIE_FILE = path.join(DATA_DIRECTORY, 'cookies.json')
const DATA_FILE = path.join(DATA_DIRECTORY, 'data.json')
const CACHE_FILE = path.join(CACHE_DIRECTORY, 'cache.json')

// Default user agent to use for API requests
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:87.0) Gecko/20100101 Firefox/87.0'

// Other variables to use in API communications
const PLATFORM = "macintosh"
const BAM_SDK_VERSION = '4.3'
const BAM_TOKEN_URL = 'https://us.edge.bamgrid.com/token'

// Default date handling
const TODAY_UTC_HOURS = 8 // UTC hours (EST + 4) into tomorrow to still use today's date

const TEAM_IDS = {'ARI':'109','ATL':'144','BAL':'110','BOS':'111','CHC':'112','CWS':'145','CIN':'113','CLE':'114','COL':'115','DET':'116','HOU':'117','KCR':'118','LAA':'108','LAD':'119','MIA':'146','MIL':'158','MIN':'142','NYM':'121','NYY':'147','OAK':'133','PHI':'143','PIT':'134','STL':'138','SDP':'135','SFG':'137','SEA':'136','TBR':'139','TEX':'140','TOR':'141','WSH':'120'}

class sessionClass {
  // Initialize the class
  constructor(argv = {}) {
    this.debug = argv.debug

    // Read credentials from file, if present
    this.credentials = this.readFileToJson(CREDENTIALS_FILE) || {}

    // Check if account credentials were provided and if they are different from the stored credentials
    if ( argv.account_username && argv.account_password && ((argv.account_username != this.credentials.account_username) || (argv.account_password != this.credentials.account_password)) ) {
      this.debuglog('updating account credentials')
      this.credentials.account_username = argv.account_username
      this.credentials.account_password = argv.account_password
      this.save_credentials()
      this.clear_session_data()
    } else {
      // Prompt for credentials if they don't exist
      if ( !this.credentials.account_username || !this.credentials.account_password ) {
        this.debuglog('prompting for account credentials')
        this.credentials.account_username = readlineSync.question('Enter account username (email address): ')
        this.credentials.account_password = readlineSync.question('Enter account password: ', { hideEchoBack: true })
        this.save_credentials()
        this.clear_session_data()
      }
    }

    // If page username/password protection is specified, retrieve or generate a random string of random length
    // to protect non-page content (streams, playlists, guides, images)
    this.protection = {}
    if ( argv.page_username && argv.page_password ) {
      // Read protection data from file, if present
      this.protection = this.readFileToJson(PROTECTION_FILE) || {}

      // Check if content_protect key was provided and if it is different from the stored one
      if ( argv.content_protect && (argv.content_protect != this.protection.content_protect) ) {
        this.log('using specified content protection key')
        this.log('you may need to update any content URLs you have copied outside of mlbserver')
        this.protection.content_protect = argv.content_protect
      } else {
        // Generate a content_protect key if it doesn't exist
        if ( !this.protection.content_protect ) {
          this.log('generating new content protection key')
          this.log('** YOU WILL NEED TO UPDATE ANY CONTENT URLS YOU HAVE COPIED OUTSIDE OF MLBSERVER **')
          this.protection.content_protect = this.getRandomString(this.getRandomInteger(32,64))
          this.save_protection()
        }
      }
    }

    // Create storage directories if they don't already exist
    this.createDirectory(DATA_DIRECTORY)
    this.createFile(COOKIE_FILE)

    // Set multiview path
    if ( argv.multiview_path ) {
      this.multiview_path = path.join(argv.multiview_path, path.basename(__dirname))
      this.createDirectory(this.multiview_path)
      this.multiview_path = path.join(this.multiview_path, MULTIVIEW_DIRECTORY_NAME)
    } else {
      this.multiview_path = path.join(__dirname, MULTIVIEW_DIRECTORY_NAME)
    }
    this.createDirectory(this.multiview_path)

    // Set up http requests with the cookie jar
    this.request = require('request-promise')
    this.jar = this.request.jar(new FileCookieStore(COOKIE_FILE))
    this.request = this.request.defaults({timeout:15000, agent:false, jar: this.request.jar()})

    // Load session data and cache from files
    this.data = this.readFileToJson(DATA_FILE) || {}
    this.cache = this.readFileToJson(CACHE_FILE) || {}

    // Define empty temporary cache (for inning data)
    this.temp_cache = {}

    // Default scan_mode and linkType values
    if ( !this.data.scan_mode ) {
      this.setScanMode('on')
    }
    if ( !this.data.linkType ) {
      this.setLinkType('embed')
    }
  }

  // Store the ports, used for generating URLs
  setPorts(port, multiviewPort) {
    this.data.port = port
    this.data.multiviewPort = multiviewPort
    this.save_session_data()
  }

  // Set the scan_mode
  // "on" will return the sample stream for all live channels.m3u stream requests
  setScanMode(x) {
    this.log('scan_mode set to ' + x)
    this.data.scan_mode = x
    this.save_session_data()
  }

  // Set the linkType
  // used for storing the desired page type across throughout site navigation
  setLinkType(x) {
    this.data.linkType = x
    this.save_session_data()
  }

  // Set the multiview stream URL path
  setMultiviewStreamURLPath(url_path) {
    this.data.multiviewStreamURLPath = url_path
    this.save_session_data()
  }

  // Some basic self-explanatory functions
  createDirectory(directoryPath) {
    if (fs.existsSync(directoryPath) && !fs.lstatSync(directoryPath).isDirectory() ){
      fs.unlinkSync(directoryPath);
    }
    if (!fs.existsSync(directoryPath)){
      fs.mkdirSync(directoryPath);
    }
  }

  createFile(filePath) {
    if (!fs.existsSync(filePath)) {
      fs.closeSync(fs.openSync(filePath, 'w'))
    }
  }

  isValidJson(str) {
    try {
      JSON.parse(str);
    } catch (e) {
      return false;
    }
    return true;
  }

  readFileToJson(filePath) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath))
    }
  }

  writeJsonToFile(jsonStr, filePath) {
    if (this.isValidJson(jsonStr)) {
      fs.writeFileSync(filePath, jsonStr)
    }
  }

  checkValidItem(item, obj) {
    if (obj.includes(item)) {
      return true
    }
    return false
  }

  returnValidItem(item, obj) {
    if (!obj.includes(item)) return obj[0]
    else return item
  }

  sortObj(obj) {
    return Object.keys(obj).sort().reduce(function (result, key) {
      result[key] = obj[key];
      return result;
    }, {});
  }

  localTimeString() {
    let curDate = new Date()
    return curDate.toLocaleString()
  }

  getTodayUTCHours() {
    return TODAY_UTC_HOURS
  }

  getUserAgent() {
    return USER_AGENT
  }

  // the live date is today's date, or if before a specified hour (UTC time), then use yesterday's date
  liveDate(hour = TODAY_UTC_HOURS) {
    let curDate = new Date()
    if ( curDate.getUTCHours() < hour ) {
      curDate.setDate(curDate.getDate()-1)
    }
    return curDate.toISOString().substring(0,10)
  }

  yesterdayDate() {
    let curDate = new Date(this.liveDate())
    curDate.setDate(curDate.getDate()-1)
    return curDate.toISOString().substring(0,10)
  }

  convertDateToXMLTV(x) {
    let newDate = String(x.getFullYear()) + String(x.getMonth() + 1).padStart(2, '0') + String(x.getDate()).padStart(2, '0') + String(x.getHours()).padStart(2, '0') + String(x.getMinutes()).padStart(2, '0') + String(x.getSeconds()).padStart(2, '0') + " "
    let offset = x.getTimezoneOffset()
    if ( offset > 0 ) {
      newDate += "-"
    } else {
      newDate += "+"
    }
    newDate += String((offset / 60)).padStart(2, '0') + "00"
    return newDate
  }

  getCacheUpdatedDate(dateString) {
    return this.cache.dates[dateString].updated
  }

  setHighlightsCacheExpiry(cache_name, expiryDate) {
    if ( !this.cache.highlights ) {
      this.cache.highlights={}
    }
    if ( !this.cache.highlights[cache_name] ) {
      this.cache.highlights[cache_name] = {}
    }
    this.cache.highlights[cache_name].highlightsCacheExpiry = expiryDate
    this.save_cache_data()
  }

  setDateCacheExpiry(cache_name, expiryDate) {
    if ( !this.cache.dates ) {
      this.cache.dates={}
    }
    if ( !this.cache.dates[cache_name] ) {
      this.cache.dates[cache_name] = {}
    }
    this.cache.dates[cache_name].dateCacheExpiry = expiryDate
    this.cache.dates[cache_name].updated = this.localTimeString()
    this.save_cache_data()
  }

  setAiringsCacheExpiry(cache_name, expiryDate) {
    if ( !this.cache.airings ) {
      this.cache.airings={}
    }
    if ( !this.cache.airings[cache_name] ) {
      this.cache.airings[cache_name] = {}
    }
    this.cache.airings[cache_name].airingsCacheExpiry = expiryDate
    this.save_cache_data()
  }

  setGamedayCacheExpiry(cache_name, expiryDate) {
    if ( !this.cache.gameday ) {
      this.cache.gameday={}
    }
    if ( !this.cache.gameday[cache_name] ) {
      this.cache.gameday[cache_name] = {}
    }
    this.cache.gameday[cache_name].gamedayCacheExpiry = expiryDate
    this.save_cache_data()
  }

  createContentCache(contentId) {
    if ( !this.cache.content ) {
      this.cache.content = {}
    }
    if ( !this.cache.content[contentId] ) {
      this.cache.content[contentId] = {}
    }
  }

  createMediaCache(mediaId) {
    if ( !this.cache.media ) {
      this.cache.media = {}
    }
    if ( !this.cache.media[mediaId] ) {
      this.cache.media[mediaId] = {}
    }
  }

  cacheMediaId(contentId, mediaId) {
    this.createContentCache(contentId)
    this.cache.content[contentId].mediaId = mediaId
    this.save_cache_data()
  }

  cacheGamePk(contentId, gamePk) {
    this.createContentCache(contentId)
    this.cache.content[contentId].gamePk = gamePk
    this.save_cache_data()
  }

  cacheStreamURL(mediaId, streamURL) {
    this.createMediaCache(mediaId)
    this.cache.media[mediaId].streamURL = streamURL
    // Expire it in 1 minute
    let seconds_to_expire = 60
    this.cache.media[mediaId].streamURLExpiry = new Date(new Date().getTime() + seconds_to_expire * 1000)
    this.save_cache_data()
  }

  markBlackoutError(mediaId) {
    this.createMediaCache(mediaId)
    this.log('saving blackout error to prevent repeated access attempts')
    this.cache.media[mediaId].blackout = true
    // Expire it in 1 hour
    let seconds_to_expire = 60*60
    this.cache.media[mediaId].blackoutExpiry = new Date(new Date().getTime() + seconds_to_expire * 1000)
    this.save_cache_data()
  }

  log(msg) {
    console.log(this.localTimeString() + ' ' + msg)
  }

  debuglog(msg) {
    if (this.debug) this.log(msg)
  }

  halt(msg) {
    this.log(msg)
    process.exit(1)
  }

  logout() {
    try {
      fs.unlinkSync(CREDENTIALS_FILE)
    } catch(e){
      this.debuglog('credentials cannot be cleared or do not exist yet : ' + e.message)
    }
  }

  clear_session_data() {
    try {
      fs.unlinkSync(COOKIE_FILE)
      fs.unlinkSync(DATA_FILE)
    } catch(e){
      this.debuglog('session cannot be cleared or does not exist yet : ' + e.message)
    }
  }

  clear_cache() {
    try {
      fs.unlinkSync(CACHE_FILE)
    } catch(e){
      this.debuglog('cache cannot be cleared or does not exist yet : ' + e.message)
    }
  }

  get_multiview_directory() {
    return this.multiview_path
  }

  clear_multiview_files() {
    try {
      if ( this.multiview_path ) {
        fs.rmdir(this.multiview_path, { recursive: true }, (err) => {
          if (err) throw err;

          this.createDirectory(this.multiview_path)
        })
      }
    } catch(e){
      this.debuglog('recursive clear multiview files error: ' + e.message)
      try {
        if ( this.multiview_path ) {
          fs.readdir(this.multiview_path, (err, files) => {
            if (err) throw err

            for (const file of files) {
              fs.unlink(path.join(this.multiview_path, file), err => {
                if (err) throw err
              })
            }
          })
        }
      } catch(e){
        this.debuglog('clear multiview files error : ' + e.message)
      }
    }
  }

  save_credentials() {
    this.writeJsonToFile(JSON.stringify(this.credentials), CREDENTIALS_FILE)
    this.debuglog('credentials saved to file')
  }

  save_protection() {
    this.writeJsonToFile(JSON.stringify(this.protection), PROTECTION_FILE)
    this.debuglog('protection data saved to file')
  }

  save_session_data() {
    this.createDirectory(DATA_DIRECTORY)
    this.writeJsonToFile(JSON.stringify(this.data), DATA_FILE)
    this.debuglog('session data saved to file')
  }

  save_cache_data() {
    this.createDirectory(CACHE_DIRECTORY)
    this.writeJsonToFile(JSON.stringify(this.cache), CACHE_FILE)
    this.debuglog('cache data saved to file')
  }

  save_json_cache_file(cache_name, cache_data) {
    this.createDirectory(CACHE_DIRECTORY)
    this.writeJsonToFile(JSON.stringify(cache_data), path.join(CACHE_DIRECTORY, cache_name+'.json'))
    this.debuglog('cache file saved')
  }

  // Generate a random integer in a range
  getRandomInteger(min, max) {
    return Math.floor(Math.random() * (max - min) ) + min;
  }

  // Generate a random string of specified length
  getRandomString(length) {
    var s = ''
    do {
      s += Math.random().toString(36).substr(2);
    } while (s.length < length)
    s = s.substr(0, length)

    return s
  }

  // Generic http GET request function
  httpGet(reqObj) {
    reqObj.jar = this.jar
    return new Promise((resolve, reject) => {
      this.request.get(reqObj)
      .then(function(body) {
        resolve(body)
      })
      .catch(function(e) {
        console.error('http get failed : ' + e.message)
        console.error(reqObj)
        process.exit(1)
      })
    })
  }

  // Generic http POST request function
  httpPost(reqObj) {
    reqObj.jar = this.jar
    return new Promise((resolve, reject) => {
      this.request.post(reqObj)
      .then(function(body) {
        resolve(body)
      })
      .catch(function(e) {
        console.error('http post failed : ' + e.message)
        console.error(reqObj)
        process.exit(1)
      })
    })
  }

  // request to use when fetching videos
  streamVideo(u, opts, tries, cb) {
    opts.jar = this.jar
    opts.headers = {
      'Authorization': this.data.bamAccessToken,
      'User-Agent': USER_AGENT
    }
    this.request(u, opts, cb)
    .catch(function(e) {
      console.error('stream video failed : ' + e.message)
      console.error(u)
      if ( tries == 1 ) process.exit(1)
    })
  }

  // request to use when fetching audio playlist URL
  async getAudioPlaylistURL(url) {
    var playlistURL
    let reqObj = {
      url: url,
      headers: {
        'Authorization': this.data.bamAccessToken,
        'User-Agent': USER_AGENT
      }
    }
    var response = await this.httpGet(reqObj)
    var body = response.toString().trim().split('\n')
    for (var i=0; i<body.length; i++) {
      if ( body[i][0] != '#' ) {
        playlistURL = body[i]
        break
      }
    }
    if ( playlistURL ) {
      return playlistURL
    } else {
      session.log('Failed to find audio playlist URL from ' + url)
      return ''
    }
  }

  async getXApiKey() {
    this.debuglog('getXApiKey')
    if ( !this.data.xApiKey || !this.data.xApiKey ) {
      await this.getApiKeys()
      if ( this.data.xApiKey ) return this.data.xApiKey
    } else {
      return this.data.xApiKey
    }
  }

  async getClientApiKey() {
    this.debuglog('getClientApiKey')
    if ( !this.data.clientApiKey ) {
      await this.getApiKeys()
      if ( this.data.clientApiKey ) return this.data.clientApiKey
    } else {
      return this.data.clientApiKey
    }
  }

  // API call
  async getApiKeys() {
    this.debuglog('getApiKeys')
    let reqObj = {
      url: 'https://www.mlb.com/tv/g632102/',
      headers: {
        'User-agent': USER_AGENT,
        'Origin': 'https://www.mlb.com',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      gzip: true
    }
    var response = await this.httpGet(reqObj)
    // disabled because it's very big!
    //this.debuglog('getApiKeys response : ' + response)
    var parsed = response.match('"x-api-key","value":"([^"]+)"')
    if ( parsed[1] ) {
      this.data.xApiKey = parsed[1]
      this.save_session_data()
    }
    parsed = response.match('"clientApiKey":"([^"]+)"')
    if ( parsed[1] ) {
      this.data.clientApiKey = parsed[1]
      this.save_session_data()
    }
  }

  // API call
  async getOktaClientId() {
    this.debuglog('getOktaClientId')
    if ( !this.data.oktaClientId ) {
      this.debuglog('need to get oktaClientId')
      let reqObj = {
        url: 'https://www.mlbstatic.com/mlb.com/vendor/mlb-okta/mlb-okta.js',
        headers: {
          'User-agent': USER_AGENT,
          'Origin': 'https://www.mlb.com',
          'Accept-Encoding': 'gzip, deflate, br'
        },
        gzip: true
      }
      var response = await this.httpGet(reqObj)
      // disabled because it's very big!
      //this.debuglog('getOktaClientId response : ' + response)
      var parsed = response.match('production:{clientId:"([^"]+)",')
      if ( parsed[1] ) {
        this.data.oktaClientId = parsed[1]
        this.save_session_data()
        return this.data.oktaClientId
      }
    } else {
      return this.data.oktaClientId
    }
  }

  // API call
  async getMediaIdFromContentId(contentId) {
    this.debuglog('getMediaIdFromContentId from ' + contentId)
    if ( this.cache.content && this.cache.content[contentId] && this.cache.content[contentId].mediaId ) {
      this.debuglog('using cached mediaId')
      return this.cache.content[contentId].mediaId
    } else {
      let cache_data = await this.getAiringsData(contentId)
      let mediaId = cache_data.data.Airings[0].mediaId
      this.cacheMediaId(contentId, mediaId)
      return mediaId
    }
  }

  // API call
  async getGamePkFromContentId(contentId) {
    this.debuglog('getGamePkFromContentId from ' + contentId)
    if ( this.cache.content && this.cache.content[contentId] && this.cache.content[contentId].gamePk ) {
      this.debuglog('using cached gamePk')
      return this.cache.content[contentId].gamePk
    } else {
      let cache_data = await this.getAiringsData(contentId)
      let gamePk = cache_data.data.Airings[0].partnerProgramId
      this.cacheGamePk(contentId, gamePk)
      return gamePk
    }
  }

  // API call
  async getStreamURL(mediaId) {
    this.debuglog('getStreamURL from ' + mediaId)
    if ( this.cache.media && this.cache.media[mediaId] && this.cache.media[mediaId].streamURL && this.cache.media[mediaId].streamURLExpiry && (Date.parse(this.cache.media[mediaId].streamURLExpiry) > new Date()) ) {
      this.debuglog('using cached streamURL')
      return this.cache.media[mediaId].streamURL
    } else if ( this.cache.media && this.cache.media[mediaId] && this.cache.media[mediaId].blackout && this.cache.media[mediaId].blackoutExpiry && (Date.parse(this.cache.media[mediaId].blackoutExpiry) > new Date()) ) {
      this.log('mediaId recently blacked out, skipping')
    } else {
      let playbackURL = 'https://edge.svcs.mlb.com/media/' + mediaId + '/scenarios/browser~csai'
      let reqObj = {
        url: playbackURL,
        simple: false,
        headers: {
          'Authorization': await this.getBamAccessToken() || this.halt('missing bamAccessToken'),
          'User-agent': USER_AGENT,
          'Accept': 'application/vnd.media-service+json; version=1',
          'x-bamsdk-version': BAM_SDK_VERSION,
          'x-bamsdk-platform': PLATFORM,
          'Origin': 'https://www.mlb.com',
          'Accept-Encoding': 'gzip, deflate, br',
          'Content-type': 'application/json'
        },
        gzip: true
      }
      var response = await this.httpGet(reqObj)
      if ( this.isValidJson(response) ) {
        this.debuglog('getStreamURL response : ' + response)
        let obj = JSON.parse(response)
        if ( obj.errors && (obj.errors[0] == 'blackout') ) {
          this.log('blackout error')
          this.markBlackoutError(mediaId)
        } else {
          this.debuglog('getStreamURL : ' + obj.stream.complete)
          this.cacheStreamURL(mediaId, obj.stream.complete)
          return obj.stream.complete
        }
      }
    }
  }

  // API call
  async getBamAccessToken() {
    this.debuglog('getBamAccessToken')
    if ( !this.data.bamAccessToken || !this.data.bamAccessTokenExpiry || (Date.parse(this.data.bamAccessTokenExpiry) < new Date()) ) {
      this.debuglog('need to get new bamAccessToken')
      let reqObj = {
        url: BAM_TOKEN_URL,
        headers: {
          'Authorization': 'Bearer ' + await this.getClientApiKey() || this.halt('missing clientApiKey'),
          'User-agent': USER_AGENT,
          'Accept': 'application/vnd.media-service+json; version=1',
          'x-bamsdk-version': BAM_SDK_VERSION,
          'x-bamsdk-platform': PLATFORM,
          'Origin': 'https://www.mlb.com',
          'Accept-Encoding': 'gzip, deflate, br',
          'Content-type': 'application/json'
        },
        form: {
          'grant_type': 'urn:ietf:params:oauth:grant-type:token-exchange',
          'platform': 'browser',
          'subject_token': await this.getEntitlementToken() || this.halt('missing EntitlementToken'),
          'subject_token_type': 'urn:bamtech:params:oauth:token-type:account'
        },
        gzip: true
      }
      var response = await this.httpPost(reqObj)
      if ( this.isValidJson(response) ) {
        let obj = JSON.parse(response)
        this.debuglog('getBamAccessToken : ' + obj.access_token)
        this.debuglog('getBamAccessToken expires in : ' + obj.expires_in)
        this.data.bamAccessToken = obj.access_token
        this.data.bamAccessTokenExpiry = new Date(new Date().getTime() + obj.expires_in * 1000)
        this.save_session_data()
        return this.data.bamAccessToken
      }
    } else {
      return this.data.bamAccessToken
    }
  }

  // API call
  async getEntitlementToken() {
    this.debuglog('getEntitlementToken')
    let reqObj = {
      url: 'https://media-entitlement.mlb.com/api/v3/jwt',
      headers: {
        'Authorization': 'Bearer ' + await this.getOktaAccessToken() || this.halt('missing OktaAccessToken'),
        'Origin': 'https://www.mlb.com',
        'x-api-key': await this.getXApiKey() || this.halt('missing xApiKey'),
        'Accept-Encoding': 'gzip, deflate, br'
      },
      qs: {
        'os': PLATFORM,
        'did': await this.getDeviceId() || this.halt('missing deviceId'),
        'appname': 'mlbtv_web'
      },
      gzip: true
    }
    var response = await this.httpGet(reqObj)
    this.debuglog('getEntitlementToken response : ' + response)
    this.debuglog('getEntitlementToken : ' + response)
    return response
  }

  async getDeviceId() {
    this.debuglog('getDeviceId')
    let reqObj = {
      url: 'https://us.edge.bamgrid.com/session',
      headers: {
        'Authorization': await this.getDeviceAccessToken() || this.halt('missing device_access_token'),
        'User-agent': USER_AGENT,
        'Origin': 'https://www.mlb.com',
        'Accept': 'application/vnd.session-service+json; version=1',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.5',
        'x-bamsdk-version': BAM_SDK_VERSION,
        'x-bamsdk-platform': PLATFORM,
        'Content-type': 'application/json',
        'TE': 'Trailers'
      },
      gzip: true
    }
    var response = await this.httpGet(reqObj)
    if ( this.isValidJson(response) ) {
      this.debuglog('getDeviceId response : ' + response)
      let obj = JSON.parse(response)
      this.debuglog('getDeviceId : ' + obj.device.id)
      return obj.device.id
    }
  }

  // API call
  async getDeviceAccessToken() {
    this.debuglog('getDeviceAccessToken')
    let reqObj = {
      url: BAM_TOKEN_URL,
      headers: {
        'Authorization': 'Bearer ' + await this.getClientApiKey() || this.halt('missing clientApiKey'),
        'Origin': 'https://www.mlb.com'
      },
      form: {
        'grant_type': 'urn:ietf:params:oauth:grant-type:token-exchange',
        'latitude': '0',
        'longitude': '0',
        'platform': 'browser',
        'subject_token': await this.getDevicesAssertion() || this.halt('missing devicesAssertion'),
        'subject_token_type': 'urn:bamtech:params:oauth:token-type:device'
      }
    }
    var response = await this.httpPost(reqObj)
    if ( this.isValidJson(response) ) {
      this.debuglog('getDeviceAccessToken response : ' + response)
      let obj = JSON.parse(response)
      this.debuglog('getDeviceAccessToken : ' + obj.access_token)
      return obj.access_token
    }
  }

  // API call
  async getDevicesAssertion() {
    this.debuglog('getDevicesAssertion')
    let reqObj = {
      url: 'https://us.edge.bamgrid.com/devices',
      headers: {
        'Authorization': 'Bearer ' + await this.getClientApiKey() || this.halt('missing clientApiKey'),
        'Origin': 'https://www.mlb.com'
      },
      json: {
        'applicationRuntime': 'firefox',
        'attributes': {},
        'deviceFamily': 'browser',
        'deviceProfile': 'macosx'
      }
    }
    var response = await this.httpPost(reqObj)
    if ( response.assertion ) {
      this.debuglog('getDevicesAssertion response : ' + response)
      this.debuglog('getDevicesAssertion : ' + response.assertion)
      return response.assertion
    }
  }

  async getOktaAccessToken() {
    this.debuglog('getOktaAccessToken')
    let oktaAccessToken = await this.retrieveOktaAccessToken()
    if ( oktaAccessToken ) return oktaAccessToken
    else {
      oktaAccessToken = await this.retrieveOktaAccessToken()
      if ( oktaAccessToken ) return oktaAccessToken
    }
  }

  // API call
  async retrieveOktaAccessToken() {
    this.debuglog('retrieveOktaAccessToken')
    if ( !this.data.oktaAccessToken || !this.data.oktaAccessTokenExpiry || (Date.parse(this.data.oktaAccessTokenExpiry) < new Date()) ) {
      this.debuglog('need to get new oktaAccessToken')
      let state = this.getRandomString(64)
      let nonce = this.getRandomString(64)
      let reqObj = {
        url: 'https://ids.mlb.com/oauth2/aus1m088yK07noBfh356/v1/authorize',
        headers: {
          'user-agent': USER_AGENT,
          'accept-encoding': 'identity'
        },
        qs: {
          'client_id': await this.getOktaClientId() || this.halt('missing oktaClientId'),
          'redirect_uri': 'https://www.mlb.com/login',
          'response_type': 'id_token token',
          'response_mode': 'okta_post_message',
          'state': state,
          'nonce': nonce,
          'prompt': 'none',
          'sessionToken': await this.getAuthnSessionToken() || this.halt('missing authnSessionToken'),
          'scope': 'openid email'
        }
      }
      var response = await this.httpGet(reqObj)
      var str = response.toString()
      this.debuglog('retrieveOktaAccessToken response : ' + str)
      if ( str.match ) {
        var errorParsed = str.match("data.error = 'login_required'")
        if ( errorParsed && errorParsed[1] ) {
          // Need to log in again
          this.log('Logging in...')
          this.data.authnSessionToken = null
          this.save_session_data()
          return false
        } else {
          var parsed_token = str.match("data.access_token = '([^']+)'")
          var parsed_expiry = str.match("data.expires_in = '([^']+)'")
          if ( parsed_token && parsed_token[1] && parsed_expiry && parsed_expiry[1] ) {
            let oktaAccessToken = parsed_token[1].split('\\x2D').join('-')
            let oktaAccessTokenExpiry = parsed_expiry[1]
            this.debuglog('retrieveOktaAccessToken : ' + oktaAccessToken)
            this.debuglog('retrieveOktaAccessToken expires in : ' + oktaAccessTokenExpiry)
            this.data.oktaAccessToken = oktaAccessToken
            this.data.oktaAccessTokenExpiry = new Date(new Date().getTime() + oktaAccessTokenExpiry * 1000)
            this.save_session_data()
            return this.data.oktaAccessToken
          }
        }
      }
    } else {
      return this.data.oktaAccessToken
    }
  }

  // API call
  async getAuthnSessionToken() {
    this.debuglog('getAuthnSessionToken')
    if ( !this.data.authnSessionToken ) {
      this.debuglog('need to get authnSessionToken')
      let reqObj = {
        url: 'https://ids.mlb.com/api/v1/authn',
        headers: {
          'user-agent': USER_AGENT,
          'accept-encoding': 'identity',
          'content-type': 'application/json'
        },
        json: {
          'username': this.credentials.account_username || this.halt('missing account username'),
          'password': this.credentials.account_password || this.halt('missing account password'),
          'options': {
            'multiOptionalFactorEnroll': false,
            'warnBeforePasswordExpired': true
          }
        }
      }
      var response = await this.httpPost(reqObj)
      if ( response.sessionToken ) {
        this.debuglog('getAuthnSessionToken response : ' + JSON.stringify(response))
        this.debuglog('getAuthnSessionToken : ' + response.sessionToken)
        this.data.authnSessionToken = response.sessionToken
        this.save_session_data()
        return this.data.authnSessionToken
      }
    } else {
      return this.data.authnSessionToken
    }
  }

  // get mediaId for a live channel request
  async getMediaId(team, mediaType, mediaDate, gameNumber) {
    try {
      this.debuglog('getMediaId')

      var mediaFeedType = 'mediaFeedType'
      if ( mediaType == 'Video' ) {
        mediaType = 'MLBTV'
      } else if ( mediaType == 'Audio' ) {
        mediaFeedType = 'type'
      }

      let gameDate = this.liveDate()
      if ( mediaDate == 'yesterday' ) {
        gameDate = this.yesterdayDate()
      } else if ( (mediaDate) && (mediaDate != 'today') ) {
        gameDate = mediaDate
      }

      let mediaId = false
      let contentId = false

      // First check if national game or if cached day data is available and non-expired
      // if not, just get data for this team
      let cache_data
      let cache_name = gameDate
      let cache_file = path.join(CACHE_DIRECTORY, gameDate+'.json')
      let currentDate = new Date()
      if ( (team.toUpperCase().indexOf('NATIONAL.') == 0) || (fs.existsSync(cache_file) && this.cache && this.cache.dates && this.cache.dates[cache_name] && this.cache.dates[cache_name].dateCacheExpiry && (currentDate <= new Date(this.cache.dates[cache_name].dateCacheExpiry))) ) {
        cache_data = await this.getDayData(gameDate)
      } else {
        cache_data = await this.getDayData(gameDate, team)
      }

      //if ( (cache_data.totalGamesInProgress > 0) || (mediaDate) ) {
        let nationalCount = 0
        for (var j = 0; j < cache_data.dates[0].games.length; j++) {
          if ( mediaId ) break
          if ( (typeof cache_data.dates[0].games[j] !== 'undefined') && cache_data.dates[0].games[j].content && cache_data.dates[0].games[j].content.media && cache_data.dates[0].games[j].content.media.epg ) {
            for (var k = 0; k < cache_data.dates[0].games[j].content.media.epg.length; k++) {
              if ( mediaId ) break
              if ( cache_data.dates[0].games[j].content.media.epg[k].title == mediaType ) {
                for (var x = 0; x < cache_data.dates[0].games[j].content.media.epg[k].items.length; x++) {
                  // check that pay TV authentication isn't required
                  if ( (mediaType == 'MLBTV') && (cache_data.dates[0].games[j].content.media.epg[k].items[x].foxAuthRequired || cache_data.dates[0].games[j].content.media.epg[k].items[x].tbsAuthRequired || cache_data.dates[0].games[j].content.media.epg[k].items[x].espnAuthRequired || cache_data.dates[0].games[j].content.media.epg[k].items[x].fs1AuthRequired || cache_data.dates[0].games[j].content.media.epg[k].items[x].mlbnAuthRequired) ) {
                    continue
                  }
                  if ( ((typeof cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType) == 'undefined') || (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType.indexOf('IN_MARKET_') == -1) ) {
                    if ( (team.toUpperCase().indexOf('NATIONAL.') == 0) && ((cache_data.dates[0].games[j].content.media.epg[k].items[x][mediaFeedType] == 'NATIONAL') || ((mediaType == 'MLBTV') && cache_data.dates[0].games[j].gameUtils.isPostSeason)) ) {
                      nationalCount += 1
                      let nationalArray = team.split('.')
                      if ( (nationalArray.length == 2) && (nationalArray[1] == nationalCount) ) {
                        this.debuglog('matched national event')
                        if ( (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON') || ((mediaDate) && ((cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ARCHIVE') || (cache_data.dates[0].games[j].status.abstractGameState == 'Final'))) ) {
                          mediaId = cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaId
                          contentId = cache_data.dates[0].games[j].content.media.epg[k].items[x].contentId
                        } else {
                          this.log('event video not yet available')
                        }
                        break
                      }
                    } else {
                      let teamType = cache_data.dates[0].games[j].content.media.epg[k].items[x][mediaFeedType].toLowerCase()
                      if ( (teamType != 'national') && (team.toUpperCase() == cache_data.dates[0].games[j].teams[teamType].team.abbreviation) ) {
                        if ( gameNumber && (gameNumber > 1) ) {
                          this.debuglog('matched team for game number 1')
                          gameNumber--
                        } else {
                          this.debuglog('matched team for event')
                          if ( (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON') || ((mediaDate) && ((cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ARCHIVE') || (cache_data.dates[0].games[j].status.abstractGameState == 'Final'))) ) {
                            mediaId = cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaId
                            contentId = cache_data.dates[0].games[j].content.media.epg[k].items[x].contentId
                          } else {
                            this.log('event video not yet available')
                          }
                          break
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        //}

        if (mediaId) {
          return { mediaId, contentId }
        }
      }
      this.log('could not find mediaId')
    } catch(e) {
      this.log('getMediaId error : ' + e.message)
    }
  }

  // get highlights for a game
  async getHighlightsData(gamePk, gameDate) {
    try {
      this.debuglog('getHighlightsData for ' + gamePk)

      let cache_data
      let cache_name = 'h' + gamePk
      let cache_file = path.join(CACHE_DIRECTORY, cache_name+'.json')
      let currentDate = new Date()
      if ( !fs.existsSync(cache_file) || !this.cache || !this.cache.highlights || !this.cache.highlights[cache_name] || !this.cache.highlights[cache_name].highlightsCacheExpiry || (currentDate > new Date(this.cache.highlights[cache_name].highlightsCacheExpiry)) ) {
        let reqObj = {
          url: 'https://statsapi.mlb.com/api/v1/game/' + gamePk + '/content',
          headers: {
            'User-agent': USER_AGENT,
            'Origin': 'https://www.mlb.com',
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-type': 'application/json'
          },
          gzip: true
        }
        var response = await this.httpGet(reqObj)
        if ( this.isValidJson(response) ) {
          //this.debuglog(response)
          cache_data = JSON.parse(response)
          this.save_json_cache_file(cache_name, cache_data)

          // Default cache period is 1 hour from now
          let oneHourFromNow = new Date()
          oneHourFromNow.setHours(oneHourFromNow.getHours()+1)
          let cacheExpiry = oneHourFromNow

          let today = this.liveDate()
          let yesterday = this.yesterdayDate()
          if ( gameDate == today ) {
            if ( (cache_data.media) && (cache_data.media.epg) ) {
              for (var i = 0; i < cache_data.media.epg.length; i++) {
                if ( cache_data.media.epg[i].items && cache_data.media.epg[i].items[0] && cache_data.media.epg[i].items[0].mediaState && (cache_data.media.epg[i].items[0].mediaState == 'MEDIA_ON') ) {
                  this.debuglog('setting cache expiry to 5 minute due to in progress games')
                  currentDate.setMinutes(currentDate.getMinutes()+5)
                  cacheExpiry = currentDate
                  break
                }
              }
            }
          } else if ( gameDate < today ) {
            this.debuglog('1+ days old, setting cache expiry to forever')
            cacheExpiry = new Date(8640000000000000)
          }

          // finally save the setting
          this.setHighlightsCacheExpiry(cache_name, cacheExpiry)
        } else {
          this.log('error : invalid json from url ' + getObj.url)
        }
      } else {
        this.debuglog('using cached highlight data')
        cache_data = this.readFileToJson(cache_file)
      }
      if (cache_data && cache_data.highlights && cache_data.highlights.highlights && cache_data.highlights.highlights.items) {
        var array = cache_data.highlights.highlights.items
        return array.sort(this.GetSortOrder('date'))
      }
    } catch(e) {
      this.log('getHighlightsData error : ' + e.message)
    }
  }

  GetSortOrder(prop) {
    return function(a, b) {
      if (a[prop] > b[prop]) {
        return 1
      } else if (a[prop] < b[prop]) {
        return -1
      }
      return 0
    }
  }

  // get data for a day, either from cache or an API call
  async getDayData(dateString, team = false) {
    try {
      let cache_data
      let cache_name = dateString
      let url = 'https://bdfed.stitch.mlbinfra.com/bdfed/transform-mlb-scoreboard?stitch_env=prod&sortTemplate=2&sportId=1&startDate=' + dateString + '&endDate=' + dateString + '&gameType=E&&gameType=S&&gameType=R&&gameType=F&&gameType=D&&gameType=L&&gameType=W&&gameType=A&language=en&leagueId=104&&leagueId=103&contextTeamId='
      if ( team ) {
        cache_name = team.toUpperCase() + dateString
        url = 'http://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=' + TEAM_IDS[team.toUpperCase()] + '&startDate=' + dateString + '&endDate=' + dateString + '&gameType=&gamePk=&hydrate=team,game(content(media(epg)))'
      }
      this.debuglog('getDayData for ' + cache_name)
      let cache_file = path.join(CACHE_DIRECTORY, cache_name+'.json')
      let currentDate = new Date()
      if ( !fs.existsSync(cache_file) || !this.cache || !this.cache.dates || !this.cache.dates[cache_name] || !this.cache.dates[cache_name].dateCacheExpiry || (currentDate > new Date(this.cache.dates[cache_name].dateCacheExpiry)) ) {
        let reqObj = {
          url: url,
          headers: {
            'User-agent': USER_AGENT,
            'Origin': 'https://www.mlb.com',
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-type': 'application/json'
          },
          gzip: true
        }
        var response = await this.httpGet(reqObj)
        if ( this.isValidJson(response) ) {
          //this.debuglog(response)
          cache_data = JSON.parse(response)
          this.save_json_cache_file(cache_name, cache_data)

          // Default cache period is 1 hour from now
          let oneHourFromNow = new Date()
          oneHourFromNow.setHours(oneHourFromNow.getHours()+1)
          let cacheExpiry = oneHourFromNow

          let today = this.liveDate()
          let yesterday = this.yesterdayDate()
          if ( dateString == today ) {
            let finals = false
            for (var i = 0; i < cache_data.dates[0].games.length; i++) {
              if ( ((cache_data.dates[0].games[i].status.abstractGameState == 'Live') && (cache_data.dates[0].games[i].status.detailedState.indexOf('Suspended') != 0)) || ((cache_data.dates[0].games[i].status.startTimeTBD == true) && (cache_data.dates[0].games[i].status.abstractGameState != 'Final') && (i > 0) && (cache_data.dates[0].games[i-1].status.abstractGameState == 'Final')) ) {
                this.debuglog('setting cache expiry to 1 minute due to in progress games or upcoming TBD game')
                currentDate.setMinutes(currentDate.getMinutes()+1)
                cacheExpiry = currentDate
                break
              } else if ( cache_data.dates[0].games[i].status.abstractGameState == 'Final' ) {
                finals = true
              } else if ( (finals == false) && (cache_data.dates[0].games[i].status.startTimeTBD == false) ) {
                let nextGameDate = new Date(cache_data.dates[0].games[i].gameDate)
                nextGameDate.setHours(nextGameDate.getHours()-1)
                this.debuglog('setting cache expiry to 1 hour before next live game')
                cacheExpiry = nextGameDate
                break
              }
            }
          } else if ( dateString > today ) {
            this.debuglog('1+ days in the future, setting cache expiry to tomorrow')
            let tomorrowDate = new Date(today)
            tomorrowDate.setDate(tomorrowDate.getDate()+1)
            let utcHours = 10
            tomorrowDate.setHours(tomorrowDate.getHours()+utcHours)
            cacheExpiry = tomorrowDate
          } else if ( dateString < yesterday ) {
            this.debuglog('2+ days old, setting cache expiry to forever')
            cacheExpiry = new Date(8640000000000000)
          }

          // finally save the setting
          this.setDateCacheExpiry(cache_name, cacheExpiry)
        } else {
          this.log('error : invalid json from url ' + getObj.url)
        }
      } else {
        this.debuglog('using cached date data')
        cache_data = this.readFileToJson(cache_file)
      }
      if (cache_data) {
        return cache_data
      }
    } catch(e) {
      this.log('getDayData error : ' + e.message)
    }
  }

  // get data for 3 weeks, either from cache or an API call
  async getWeeksData() {
    try {
      this.debuglog('getWeeksData')

      // use 5 AM UTC time as the threshold to advance 1 day
      let utcHours = 5

      let cache_data
      let cache_name = 'week'
      let cache_file = path.join(CACHE_DIRECTORY, cache_name + '.json')
      let currentDate = new Date()
      if ( !fs.existsSync(cache_file) || !this.cache || !this.cache.weekCacheExpiry || (currentDate > new Date(this.cache.weekCacheExpiry)) ) {
        let startDate = this.liveDate(utcHours)
        let endDate = new Date(startDate)
        endDate.setDate(endDate.getDate()+20)
        endDate = endDate.toISOString().substring(0,10)
        let reqObj = {
          url: 'https://bdfed.stitch.mlbinfra.com/bdfed/transform-mlb-scoreboard?stitch_env=prod&sortTemplate=2&sportId=1&startDate=' + startDate + '&endDate=' + endDate + '&gameType=E&&gameType=S&&gameType=R&&gameType=F&&gameType=D&&gameType=L&&gameType=W&&gameType=A&language=en&leagueId=104&&leagueId=103&contextTeamId=',
          headers: {
            'User-agent': USER_AGENT,
            'Origin': 'https://www.mlb.com',
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-type': 'application/json'
          },
          gzip: true
        }
        var response = await this.httpGet(reqObj)
        if ( this.isValidJson(response) ) {
          //this.debuglog(response)
          cache_data = JSON.parse(response)
          this.save_json_cache_file(cache_name, cache_data)
          this.debuglog('setting channels cache expiry to next day')
          let nextDate = new Date(startDate)
          nextDate.setDate(nextDate.getDate()+1)
          nextDate.setHours(nextDate.getHours()+utcHours)
          this.cache.weekCacheExpiry = nextDate
          this.save_cache_data()
        } else {
          this.log('error : invalid json from url ' + getObj.url)
        }
      } else {
        this.debuglog('using cached channel data')
        cache_data = this.readFileToJson(cache_file)
      }
      if (cache_data) {
        return cache_data
      }
    } catch(e) {
      this.log('getWeeksData error : ' + e.message)
    }
  }

  // get live channels in M3U format
  async getChannels(mediaType, includeTeams, excludeTeams, server, resolution, pipe, startingChannelNumber) {
    try {
      this.debuglog('getChannels')

      var mediaFeedType = 'mediaFeedType'
      if ( mediaType == 'Video' ) {
        mediaType = 'MLBTV'
      } else if ( mediaType == 'Audio' ) {
        mediaFeedType = 'type'
      }

      let cache_data = await this.getWeeksData()
      if (cache_data) {
        var channels = {}
        var nationalChannels = {}
        let prevDateIndex = {MLBTV:-1,Audio:-1}
        for (var i = 0; i < cache_data.dates.length; i++) {
          let dateIndex = {MLBTV:i,Audio:i}
          let nationalCounter = {MLBTV:0,Audio:0}
          for (var j = 0; j < cache_data.dates[i].games.length; j++) {
            if ( cache_data.dates[i].games[j].content && cache_data.dates[i].games[j].content.media && cache_data.dates[i].games[j].content.media.epg ) {
              for (var k = 0; k < cache_data.dates[i].games[j].content.media.epg.length; k++) {
                let mediaTitle = cache_data.dates[i].games[j].content.media.epg[k].title
                if ( mediaType == mediaTitle ) {
                  for (var x = 0; x < cache_data.dates[i].games[j].content.media.epg[k].items.length; x++) {
                    // check that pay TV authentication isn't required
                    if ( (mediaType == 'MLBTV') && (cache_data.dates[i].games[j].content.media.epg[k].items[x].foxAuthRequired || cache_data.dates[i].games[j].content.media.epg[k].items[x].tbsAuthRequired || cache_data.dates[i].games[j].content.media.epg[k].items[x].espnAuthRequired || cache_data.dates[i].games[j].content.media.epg[k].items[x].fs1AuthRequired || cache_data.dates[i].games[j].content.media.epg[k].items[x].mlbnAuthRequired) ) {
                      continue
                    }
                    if ( ((((typeof cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedType) == 'undefined') || (cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedType.indexOf('IN_MARKET_') == -1)) && (((typeof cache_data.dates[i].games[j].content.media.epg[k].items[x].language) == 'undefined') || (cache_data.dates[i].games[j].content.media.epg[k].items[x].language != 'es'))) ) {
                      let teamType = cache_data.dates[i].games[j].content.media.epg[k].items[x][mediaFeedType]
                      if ( (mediaType == 'MLBTV') && cache_data.dates[i].games[j].gameUtils.isPostSeason ) {
                        teamType = 'NATIONAL'
                      }
                      let team
                      let opponent_team
                      if ( teamType == 'NATIONAL' ) {
                        team = cache_data.dates[i].games[j].teams['home'].team.abbreviation
                        opponent_team = cache_data.dates[i].games[j].teams['away'].team.abbreviation

                        if ( dateIndex[mediaTitle] > prevDateIndex[mediaTitle] ) {
                          prevDateIndex[mediaTitle] = dateIndex[mediaTitle]
                          nationalCounter[mediaTitle] = 1
                        } else {
                          nationalCounter[mediaTitle] += 1
                        }
                      } else {
                        teamType = teamType.toLowerCase()
                        let opponent_teamType = 'away'
                        if ( teamType == 'away' ) {
                          opponent_teamType = 'home'
                        }
                        team = cache_data.dates[i].games[j].teams[teamType].team.abbreviation
                        opponent_team = cache_data.dates[i].games[j].teams[opponent_teamType].team.abbreviation
                      }
                      if ( (excludeTeams.length > 0) && (excludeTeams.includes(team) || excludeTeams.includes(opponent_team) || excludeTeams.includes(teamType)) ) {
                        continue
                      } else if ( (includeTeams.length == 0) || includeTeams.includes(team) || includeTeams.includes(teamType) ) {
                        if ( (teamType == 'NATIONAL') && ((includeTeams.length == 0) || ((includeTeams.length > 0) && includeTeams.includes(teamType))) ) {
                          team = teamType + '.' + nationalCounter[mediaTitle]
                        }
                        let channelid = mediaType + '.' + team
                        let channelMediaType = mediaType
                        if ( mediaType == 'MLBTV' ) {
                          channelMediaType = 'Video'
                        }
                        let stream = server + '/stream.m3u8?team=' + encodeURIComponent(team) + '&mediaType=' + channelMediaType
                        if ( channelMediaType == 'Video' ) {
                          stream += '&resolution=' + resolution
                        }
                        if ( this.protection.content_protect ) stream += '&content_protect=' + this.protection.content_protect
                        if ( pipe == 'true' ) {
                          stream = 'pipe://ffmpeg -hide_banner -loglevel fatal -i "' + stream + '" -map 0:v -map 0:a -c copy -metadata service_provider="MLBTV" -metadata service_name="' + channelid + '" -f mpegts pipe:1'
                        }
                        let icon = server
                        if ( (teamType == 'NATIONAL') && ((includeTeams.length == 0) || ((includeTeams.length > 0) && includeTeams.includes(teamType))) ) {
                          icon += '/image.svg?teamId=MLB'
                          if ( this.protection.content_protect ) icon += '&content_protect=' + this.protection.content_protect
                          nationalChannels[channelid] = {}
                          nationalChannels[channelid].channellogo = icon
                          nationalChannels[channelid].stream = stream
                          nationalChannels[channelid].mediatype = mediaType
                        } else {
                          icon += '/image.svg?teamId=' + cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedSubType
                          if ( this.protection.content_protect ) icon += '&content_protect=' + this.protection.content_protect
                          channels[channelid] = {}
                          channels[channelid].channellogo = icon
                          channels[channelid].stream = stream
                          channels[channelid].mediatype = mediaType
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        channels = this.sortObj(channels)
        channels = Object.assign(channels, nationalChannels)

        // Big Inning
        if ( mediaType == 'MLBTV' ) {
          if ( (excludeTeams.length > 0) && excludeTeams.includes('BIGINNING') ) {
            // do nothing
          } else if ( (includeTeams.length == 0) || includeTeams.includes('BIGINNING') ) {
            let extraChannels = {}
            let channelid = mediaType + '.BIGINNING'
            let icon = server + '/image.svg?teamId=MLB'
            if ( this.protection.content_protect ) icon += '&content_protect=' + this.protection.content_protect
            let stream = server + '/stream.m3u8?type=biginning&mediaType=Video&resolution=' + resolution
            if ( this.protection.content_protect ) stream += '&content_protect=' + this.protection.content_protect
            if ( pipe == 'true' ) {
              stream = 'pipe://ffmpeg -hide_banner -loglevel fatal -i "' + stream + '" -map 0:v -map 0:a -c copy -metadata service_provider="MLBTV" -metadata service_name="' + channelid + '" -f mpegts pipe:1'
            }
            extraChannels[channelid] = {}
            extraChannels[channelid].channellogo = icon
            extraChannels[channelid].stream = stream
            extraChannels[channelid].mediatype = mediaType
            channels = Object.assign(channels, extraChannels)
          }
        }

        // Multiview
        if ( (mediaType == 'MLBTV') && (typeof this.data.multiviewStreamURLPath !== 'undefined') ) {
          if ( (excludeTeams.length > 0) && excludeTeams.includes('MULTIVIEW') ) {
            // do nothing
          } else if ( (includeTeams.length == 0) || includeTeams.includes('MULTIVIEW') ) {
            let extraChannels = {}
            let channelid = mediaType + '.MULTIVIEW'
            let icon = server + '/image.svg?teamId=MLB'
            if ( this.protection.content_protect ) icon += '&content_protect=' + this.protection.content_protect
            let stream = server.replace(':' + this.data.port, ':' + this.data.multiviewPort) + this.data.multiviewStreamURLPath
            if ( pipe == 'true' ) {
              stream = 'pipe://ffmpeg -hide_banner -loglevel fatal -i "' + stream + '" -map 0:v -map 0:a -c copy -metadata service_provider="MLBTV" -metadata service_name="' + channelid + '" -f mpegts pipe:1'
            }
            extraChannels[channelid] = {}
            extraChannels[channelid].channellogo = icon
            extraChannels[channelid].stream = stream
            extraChannels[channelid].mediatype = mediaType
            channels = Object.assign(channels, extraChannels)
          }
        }

        let channelnumber = startingChannelNumber
        var body = '#EXTM3U' + "\n"
        //body += '#EXTINF:-1 CUID="MLBSERVER.SAMPLE.VIDEO" tvg-id="MLBSERVER.SAMPLE.VIDEO" tvg-name="MLBSERVER.SAMPLE.VIDEO",MLBSERVER SAMPLE VIDEO' + "\n"
        //body += '/stream.m3u8' + "\n"
        for (const [key, value] of Object.entries(channels)) {
          body += '#EXTINF:-1 CUID="' + key + '" channelID="' + key + '" tvg-num="1.' + channelnumber + '" tvg-chno="1.' + channelnumber + '" tvg-id="' + key + '" tvg-name="' + key + '" tvg-logo="' + value.channellogo + '" group-title="' + value.mediatype + '",' + key + "\n"
          body += value.stream + "\n"
          channelnumber++
        }
        return body
      }
    } catch(e) {
      this.log('getChannels error : ' + e.message)
    }
  }

  // get guide.xml file, in XMLTV format
  async getGuide(mediaType, includeTeams, excludeTeams, server) {
    try {
      this.debuglog('getGuide')

      var mediaFeedType = 'mediaFeedType'
      if ( mediaType == 'Video' ) {
        mediaType = 'MLBTV'
      } else if ( mediaType == 'Audio' ) {
        mediaFeedType = 'type'
      }

      let cache_data = await this.getWeeksData()
      if (cache_data) {
        var channels = {}
        var programs = ""
        let prevDateIndex = {MLBTV:-1,Audio:-1}
        for (var i = 0; i < cache_data.dates.length; i++) {
          let dateIndex = {MLBTV:i,Audio:i}
          let nationalCounter = {MLBTV:0,Audio:0}
          for (var j = 0; j < cache_data.dates[i].games.length; j++) {
            if ( cache_data.dates[i].games[j].content && cache_data.dates[i].games[j].content.media && cache_data.dates[i].games[j].content.media.epg ) {
              for (var k = 0; k < cache_data.dates[i].games[j].content.media.epg.length; k++) {
                let mediaTitle = cache_data.dates[i].games[j].content.media.epg[k].title
                if ( mediaType == mediaTitle ) {
                  for (var x = 0; x < cache_data.dates[i].games[j].content.media.epg[k].items.length; x++) {
                    // check that pay TV authentication isn't required
                    if ( (mediaType == 'MLBTV') && (cache_data.dates[i].games[j].content.media.epg[k].items[x].foxAuthRequired || cache_data.dates[i].games[j].content.media.epg[k].items[x].tbsAuthRequired || cache_data.dates[i].games[j].content.media.epg[k].items[x].espnAuthRequired || cache_data.dates[i].games[j].content.media.epg[k].items[x].fs1AuthRequired || cache_data.dates[i].games[j].content.media.epg[k].items[x].mlbnAuthRequired) ) {
                      continue
                    }
                    if ( ((((typeof cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedType) == 'undefined') || (cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedType.indexOf('IN_MARKET_') == -1)) && (((typeof cache_data.dates[i].games[j].content.media.epg[k].items[x].language) == 'undefined') || (cache_data.dates[i].games[j].content.media.epg[k].items[x].language != 'es'))) ) {
                      let teamType = cache_data.dates[i].games[j].content.media.epg[k].items[x][mediaFeedType]
                      if ( (mediaType == 'MLBTV') && cache_data.dates[i].games[j].gameUtils.isPostSeason ) {
                        teamType = 'NATIONAL'
                      }
                      let team
                      let opponent_team
                      if ( teamType == 'NATIONAL' ) {
                        team = cache_data.dates[i].games[j].teams['home'].team.abbreviation
                        opponent_team = cache_data.dates[i].games[j].teams['away'].team.abbreviation

                        if ( dateIndex[mediaTitle] > prevDateIndex[mediaTitle] ) {
                          prevDateIndex[mediaTitle] = dateIndex[mediaTitle]
                          nationalCounter[mediaTitle] = 1
                        } else {
                          nationalCounter[mediaTitle] += 1
                        }
                      } else {
                        teamType = teamType.toLowerCase()
                        let opponent_teamType = 'away'
                        if ( teamType == 'away' ) {
                          opponent_teamType = 'home'
                        }
                        team = cache_data.dates[i].games[j].teams[teamType].team.abbreviation
                        opponent_team = cache_data.dates[i].games[j].teams[opponent_teamType].team.abbreviation
                      }
                      if ( (excludeTeams.length > 0) && (excludeTeams.includes(team) || excludeTeams.includes(opponent_team) || excludeTeams.includes(teamType)) ) {
                        continue
                      } else if ( (includeTeams.length == 0) || includeTeams.includes(team) || includeTeams.includes(teamType) ) {
                        let icon = server
                        if ( (teamType == 'NATIONAL') && ((includeTeams.length == 0) || ((includeTeams.length > 0) && includeTeams.includes(teamType))) ) {
                          team = teamType + '.' + nationalCounter[mediaTitle]
                          icon += '/image.svg?teamId=MLB'
                        } else {
                          icon += '/image.svg?teamId=' + cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedSubType
                        }
                        if ( this.protection.content_protect ) icon += '&content_protect=' + this.protection.content_protect
                        let channelid = mediaType + '.' + team
                        channels[channelid] = {}
                        channels[channelid].name = channelid
                        channels[channelid].icon = icon

                        let title = 'MLB Baseball: ' + cache_data.dates[i].games[j].teams['away'].team.teamName + ' at ' + cache_data.dates[i].games[j].teams['home'].team.teamName + ' (' + cache_data.dates[i].games[j].content.media.epg[k].items[x].callLetters
                        if ( mediaType == 'Audio' ) {
                          title += ' Radio'
                        }
                        title += ')'

                        let description = ''
                        if ( cache_data.dates[i].games[j].doubleHeader != 'N' ) {
                          description += 'Game ' + cache_data.dates[i].games[j].gameNumber + '. '
                        }
                        if ( (cache_data.dates[i].games[j].teams['away'].probablePitcher && cache_data.dates[i].games[j].teams['away'].probablePitcher.fullName) || (cache_data.dates[i].games[j].teams['home'].probablePitcher && cache_data.dates[i].games[j].teams['home'].probablePitcher.fullName) ) {
                          if ( cache_data.dates[i].games[j].teams['away'].probablePitcher && cache_data.dates[i].games[j].teams['away'].probablePitcher.fullName ) {
                            description += cache_data.dates[i].games[j].teams['away'].probablePitcher.fullName
                          } else {
                            description += 'TBD'
                          }
                          description += ' vs. '
                          if ( cache_data.dates[i].games[j].teams['home'].probablePitcher && cache_data.dates[i].games[j].teams['home'].probablePitcher.fullName ) {
                            description += cache_data.dates[i].games[j].teams['home'].probablePitcher.fullName
                          } else {
                            description += 'TBD'
                          }
                          description += '. '
                        }
                        if ( teamType == 'NATIONAL' ) {
                          if ( cache_data.dates[i].games[j].content.media.epg[k].items[x][mediaFeedType] == 'AWAY' ) {
                            description += cache_data.dates[i].games[j].teams['away'].team.teamName
                          } else {
                            description += cache_data.dates[i].games[j].teams['home'].team.teamName
                          }
                          description += ' alternate audio. '
                        }

                        let gameDate = new Date(cache_data.dates[i].games[j].gameDate)
                        let gameHours = 3
                        // Handle suspended, TBD, and doubleheaders
                        if ( cache_data.dates[i].games[j].status.resumedFrom ) {
                          gameHours = 1
                          if ( cache_data.dates[i].games[j].description ) {
                            description += cache_data.dates[i].games[j].description
                          } else {
                            description += 'Resumption of suspended game.'
                          }
                          gameDate = new Date(cache_data.dates[i].games[j].gameDate)
                          gameDate.setHours(gameDate.getHours()+1)
                        } else if ( (cache_data.dates[i].games[j].status.startTimeTBD == true) && (cache_data.dates[i].games[j].doubleHeader == 'Y') && (cache_data.dates[i].games[j].gameNumber == 2) ) {
                          description += 'Start time TBD.'
                          gameDate = new Date(cache_data.dates[i].games[j-1].gameDate)
                          gameDate.setHours(gameDate.getHours()+4)
                        } else if ( cache_data.dates[i].games[j].status.startTimeTBD == true ) {
                          continue
                        }
                        let start = this.convertDateToXMLTV(gameDate)
                        gameDate.setHours(gameDate.getHours()+gameHours)
                        let stop = this.convertDateToXMLTV(gameDate)

                        programs += "\n" + '    <programme channel="' + channelid + '" start="' + start + '" stop="' + stop + '">' + "\n" +
                        '      <title lang="en">' + title + '</title>' + "\n" +
                        '      <desc lang="en">' + description.trim() + '</desc>' + "\n" +
                        '      <category lang="en">Sports</category>' + "\n" +
                        '      <icon src="' + icon + '"></icon>' + "\n" +
                        '    </programme>'
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // Big Inning
        if ( mediaType == 'MLBTV' ) {
          if ( (excludeTeams.length > 0) && excludeTeams.includes('BIGINNING') ) {
            // do nothing
          } else if ( (includeTeams.length == 0) || includeTeams.includes('BIGINNING') ) {
            let icon = server + '/image.svg?teamId=MLB'
            if ( this.protection.content_protect ) icon += '&content_protect=' + this.protection.content_protect
            let channelid = mediaType + '.BIGINNING'
            channels[channelid] = {}
            channels[channelid].name = channelid
            channels[channelid].icon = icon

            let title = 'MLB Big Inning'
            let description = 'Live look-ins and big moments from around the league'

            await this.getBigInningSchedule()
            for (var i = 0; i < cache_data.dates.length; i++) {
              let gameDate = cache_data.dates[i].date
              if ( this.cache.bigInningSchedule[gameDate] && this.cache.bigInningSchedule[gameDate].start ) {
                let start = this.convertDateToXMLTV(new Date(this.cache.bigInningSchedule[gameDate].start))
                let stop = this.convertDateToXMLTV(new Date(this.cache.bigInningSchedule[gameDate].end))

                programs += "\n" + '    <programme channel="' + channelid + '" start="' + start + '" stop="' + stop + '">' + "\n" +
                '      <title lang="en">' + title + '</title>' + "\n" +
                '      <desc lang="en">' + description.trim() + '</desc>' + "\n" +
                '      <category lang="en">Sports</category>' + "\n" +
                '      <icon src="' + icon + '"></icon>' + "\n" +
                '    </programme>'
              }
            }
          }
        }

        // Multiview
        if ( (mediaType == 'MLBTV') && (typeof this.data.multiviewStreamURL !== 'undefined') ) {
          if ( (excludeTeams.length > 0) && excludeTeams.includes('MULTIVIEW') ) {
            // do nothing
          } else if ( (includeTeams.length == 0) || includeTeams.includes('MULTIVIEW') ) {
            let icon = server + '/image.svg?teamId=MLB'
            if ( this.protection.content_protect ) icon += '&content_protect=' + this.protection.content_protect
            let channelid = mediaType + '.MULTIVIEW'
            channels[channelid] = {}
            channels[channelid].name = channelid
            channels[channelid].icon = icon

            let title = 'MLB Multiview'
            let description = 'Watch up to 4 games at once. Requires starting the multiview stream in the web interface first, and stopping it when done.'

            for (var i = 0; i < cache_data.dates.length; i++) {
              let gameDate = new Date(cache_data.dates[i].date + 'T00:00:00.000')
              let start = this.convertDateToXMLTV(gameDate)
              gameDate.setDate(gameDate.getDate()+1)
              let stop = this.convertDateToXMLTV(gameDate)

              programs += "\n" + '    <programme channel="' + channelid + '" start="' + start + '" stop="' + stop + '">' + "\n" +
              '      <title lang="en">' + title + '</title>' + "\n" +
              '      <desc lang="en">' + description.trim() + '</desc>' + "\n" +
              '      <category lang="en">Sports</category>' + "\n" +
              '      <icon src="' + icon + '"></icon>' + "\n" +
              '    </programme>'
            }
          }
        }

        var body = '<?xml version="1.0" encoding="UTF-8"?>' + "\n" +
        '<!DOCTYPE tv SYSTEM "xmltv.dd">' + "\n" +
        '  <tv generator-info-name="mlbserver" source-info-name="mlbserver">'
        for (const [key, value] of Object.entries(channels)) {
          body += "\n" + '    <channel id="' + key + '">' + "\n" +
          '      <display-name>' + value.name + '</display-name>' + "\n" +
          '      <icon src="' + value.icon + '"></icon>' + "\n" +
          '    </channel>'
        }
        body += programs + "\n" + '  </tv>'

        return body
      }
    } catch(e) {
      this.log('getGuide error : ' + e.message)
    }
  }

  // Get image from cache or request
  async getImage(teamId) {
    this.debuglog('getImage ' + teamId)
    let imagePath = path.join(CACHE_DIRECTORY, teamId + '.svg')
    if ( fs.existsSync(imagePath) ) {
      this.debuglog('using cached image for ' + teamId)
      return fs.readFileSync(imagePath)
    } else {
      this.debuglog('requesting new image for ' + teamId)
      let imageURL = 'https://www.mlbstatic.com/team-logos/' + teamId + '.svg'
      if ( teamId == 'MLB' ) {
        imageURL = 'https://www.mlbstatic.com/team-logos/league-on-dark/1.svg'
      }
      let reqObj = {
        url: imageURL,
        headers: {
          'User-agent': USER_AGENT,
          'origin': 'https://www.mlb.com'
        }
      }
      var response = await this.httpGet(reqObj)
      if ( response ) {
        this.debuglog('getImage response : ' + response)
        fs.writeFileSync(imagePath, response)
      } else {
        this.debuglog('failed to get image for ' + teamId)
      }
    }
  }

  // Get airings data for a game
  async getAiringsData(contentId, gamePk = false) {
    try {
      this.debuglog('getAiringsData')

      let cache_data
      let cache_name = contentId
      let cache_file = path.join(CACHE_DIRECTORY, contentId+'.json')
      let url = 'https://search-api-mlbtv.mlb.com/svc/search/v2/graphql/persisted/query/core/Airings'
      let qs = { variables: '%7B%22contentId%22%3A%22' + contentId + '%22%7D' }
      if ( gamePk ) {
        url = 'https://search-api-mlbtv.mlb.com/svc/search/v2/graphql/persisted/query/core/Airings?variables={%22partnerProgramIds%22%3A[%22' + gamePk + '%22]}'
        qs = {}
      }
      let currentDate = new Date()
      if ( !fs.existsSync(cache_file) || !this.cache || !this.cache.airings || !this.cache.airings[cache_name] || !this.cache.airings[cache_name].airingsCacheExpiry || (currentDate > new Date(this.cache.airings[cache_name].airingsCacheExpiry)) ) {
        let reqObj = {
          url: url,
          qs: qs,
          headers: {
            'Accept': 'application/json',
            'X-BAMSDK-Version': BAM_SDK_VERSION,
            'X-BAMSDK-Platform': PLATFORM,
            'User-Agent': USER_AGENT,
            'Origin': 'https://www.mlb.com',
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-type': 'application/json'
          },
          gzip: true
        }
        var response = await this.httpGet(reqObj)
        if ( this.isValidJson(response) ) {
          this.debuglog(response)
          cache_data = JSON.parse(response)
          if ( gamePk ) {
            this.debuglog('searching for alternate airing with break data')
            let most_milestones = 0
            let most_milestones_index = -1
            let offset_index = 1
            let previous_offset
            let previous_startDatetime
            let new_startDatetime
            let new_offset
            for ( var i=0; i<cache_data.data.Airings.length; i++ ) {
              if ( cache_data.data.Airings[i].milestones ) {
                if ( cache_data.data.Airings[i].contentId && (cache_data.data.Airings[i].contentId == contentId) ) {
                  if ( cache_data.data.Airings[i].milestones[0].milestoneTime[0].type == 'offset' ) offset_index = 0
                  previous_offset = cache_data.data.Airings[i].milestones[0].milestoneTime[offset_index].start
                  previous_startDatetime = new Date(cache_data.data.Airings[i].milestones[0].milestoneTime[(offset_index == 0 ? 1 : 0)].startDatetime)
                  continue
                }
                if ( cache_data.data.Airings[i].milestones.length > most_milestones ) {
                  most_milestones = cache_data.data.Airings[i].milestones.length
                  most_milestones_index = i
                }
              }
            }
            if ( most_milestones_index && previous_startDatetime ) {
              this.debuglog('found alternate airing with break data')
              let temp_airing = cache_data.data.Airings[most_milestones_index]

              offset_index = 1
              if ( temp_airing.milestones[0].milestoneTime[0].type == 'offset' ) offset_index = 0
              new_offset = temp_airing.milestones[0].milestoneTime[offset_index].start
              new_startDatetime = new Date(temp_airing.milestones[0].milestoneTime[(offset_index == 0 ? 1 : 0)].startDatetime)

              let offset_adjust = (new_startDatetime / 1000) - (previous_startDatetime/1000) - previous_offset - new_offset
              this.debuglog('adjusting breaks by ' + offset_adjust)

              for ( var j=0; j<temp_airing.milestones.length; j++ ) {
                offset_index = 1
                if ( temp_airing.milestones[j].milestoneTime[0].type == 'offset' ) offset_index = 0
                temp_airing.milestones[j].milestoneTime[offset_index].start += offset_adjust
              }

              cache_data.data.Airings = [{}]
              cache_data.data.Airings[0] = temp_airing
            }
          }
          this.save_json_cache_file(contentId, cache_data)

          // Default cache period is 1 hour from now
          let oneHourFromNow = new Date()
          oneHourFromNow.setHours(oneHourFromNow.getHours()+1)
          let cacheExpiry = oneHourFromNow

          let today = this.liveDate()
          let game_date = new Date(cache_data.data.Airings[0].startDate)
          let compare_date = game_date.getFullYear() + '-' + (game_date.getMonth()+1).toString().padStart(2, '0') + '-' + game_date.getDate().toString().padStart(2, '0')

          if ( compare_date == today ) {
            if ( (cache_data.data.Airings[0].mediaConfig.productType == 'LIVE') || ((typeof cache_data.data.Airings[0].milestones !== 'undefined') && (typeof cache_data.data.Airings[0].milestones[0] !== 'undefined') && (typeof cache_data.data.Airings[0].milestones[0].milestoneTime !== 'undefined') && (typeof cache_data.data.Airings[0].milestones[0].milestoneTime[0].start !== 'undefined') && ((cache_data.data.Airings[0].milestones[0].milestoneTime[0].start > 20*60) || (cache_data.data.Airings[0].milestones[0].milestoneTime[1].start > 20*60))) ) {
              this.debuglog('setting cache expiry to 5 minutes for live or untrimmed games today')
              currentDate.setMinutes(currentDate.getMinutes()+5)
              cacheExpiry = currentDate
            }
          } else if ( compare_date < today ) {
            this.debuglog('setting cache expiry to forever for past games')
            cacheExpiry = new Date(8640000000000000)
          }

          // finally save the setting
          this.setAiringsCacheExpiry(cache_name, cacheExpiry)
        } else {
          this.log('error : invalid json from url ' + getObj.url)
        }
      } else {
        this.debuglog('using cached airings data')
        cache_data = this.readFileToJson(cache_file)
      }
      if (cache_data) {
        return cache_data
      }
    } catch(e) {
      this.log('getAiringsData error : ' + e.message)
    }
  }

  // Get gameday data for a game (play and pitch data)
  async getGamedayData(contentId) {
    try {
      this.debuglog('getGamedayData')

      let gamePk = await this.getGamePkFromContentId(contentId)

      let cache_data
      let cache_name = 'g' + gamePk
      let cache_file = path.join(CACHE_DIRECTORY, cache_name+'.json')
      let currentDate = new Date()
      if ( !fs.existsSync(cache_file) || !this.cache || !this.cache.gameday || !this.cache.gameday[cache_name] || !this.cache.gameday[cache_name].gamedayCacheExpiry || (currentDate > new Date(this.cache.gameday[cache_name].gamedayCacheExpiry)) ) {
        let reqObj = {
          url: 'http://statsapi.mlb.com/api/v1.1/game/' + gamePk + '/feed/live',
          headers: {
            'User-agent': USER_AGENT,
            'Origin': 'https://www.mlb.com',
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-type': 'application/json'
          },
          gzip: true
        }
        var response = await this.httpGet(reqObj)
        if ( this.isValidJson(response) ) {
          this.debuglog(response)
          cache_data = JSON.parse(response)
          this.save_json_cache_file(cache_name, cache_data)

          // Default cache period is 1 hour from now
          let oneHourFromNow = new Date()
          oneHourFromNow.setHours(oneHourFromNow.getHours()+1)
          let cacheExpiry = oneHourFromNow

          if ( (cache_data.gameData.status.abstractGameState == 'Live') && (cache_data.gameData.status.detailedState.indexOf('Suspended') != 0) ) {
            this.debuglog('setting cache expiry to 5 minutes for live game')
            currentDate.setMinutes(currentDate.getMinutes()+5)
            cacheExpiry = currentDate
          } else {
            let today = this.liveDate()

            if ( cache_data.gameData.datetime.officialDate < today ) {
              this.debuglog('setting cache expiry to forever for past games')
              cacheExpiry = new Date(8640000000000000)
            }
          }

          // finally save the setting
          this.setGamedayCacheExpiry(cache_name, cacheExpiry)
        } else {
          this.log('error : invalid response from url ' + getObj.url)
        }
      } else {
        this.debuglog('using cached gameday data')
        cache_data = this.readFileToJson(cache_file)
      }
      if (cache_data) {
        return cache_data
      }
    } catch(e) {
      this.log('getGamedayData error : ' + e.message)
    }
  }

  // Get broadcast start timestamp
  async getBroadcastStart(contentId) {
    try {
      this.debuglog('getBroadcastStart')

      if ( !this.temp_cache[contentId] ) {
        this.temp_cache[contentId] = {}
      }

      let cache_data = await this.getAiringsData(contentId)
      // If VOD and we have fewer than 2 milestones, use the gamePk to look for more milestones in a different airing
      if ( cache_data.data.Airings[0].mediaConfig.productType && (cache_data.data.Airings[0].mediaConfig.productType == 'VOD') && cache_data.data.Airings[0].milestones && (cache_data.data.Airings[0].milestones.length < 2) ) {
        this.log('too few milestones, looking for more')
        this.cache.airings[contentId] = {}
        cache_data = await this.getAiringsData(contentId, cache_data.data.Airings[0].partnerProgramId)
      }

      let broadcast_start_offset
      let broadcast_start_timestamp

      if ( cache_data.data.Airings[0].milestones ) {
        for (var j = 0; j < cache_data.data.Airings[0].milestones.length; j++) {
          if ( cache_data.data.Airings[0].milestones[j].milestoneType == 'BROADCAST_START' ) {
            let offset_index = 1
            let offset
            if ( cache_data.data.Airings[0].milestones[j].milestoneTime[0].type == 'offset' ) {
              offset_index = 0
            }
            broadcast_start_offset = cache_data.data.Airings[0].milestones[j].milestoneTime[offset_index].start

            // Broadcast start
            broadcast_start_timestamp = new Date(cache_data.data.Airings[0].milestones[j].milestoneTime[(offset_index == 0 ? 1 : 0)].startDatetime)
            this.debuglog('broadcast start time detected as ' + broadcast_start_timestamp)
            this.debuglog('offset detected as ' + broadcast_start_offset)
            broadcast_start_timestamp.setSeconds(broadcast_start_timestamp.getSeconds()-broadcast_start_offset)
            this.debuglog('new start time is ' + broadcast_start_timestamp)
            break
          }
        }
      }

      if ( broadcast_start_offset && broadcast_start_timestamp ) {
        return { broadcast_start_offset, broadcast_start_timestamp }
      }
    } catch(e) {
      this.log('getBroadcastStart error : ' + e.message)
    }
  }

  // Get event offsets into temporary cache
  async getEventOffsets(contentId, skip_types, skip_adjust = 0) {
    try {
      this.debuglog('getEventOffsets')

      if ( skip_adjust != 0 ) session.log('manual adjustment of ' + skip_adjust + ' seconds being applied')

      // Get the broadcast start time first -- event times will be relative to this
      let broadcast_start = await this.getBroadcastStart(contentId)
      let broadcast_start_offset = broadcast_start.broadcast_start_offset
      let broadcast_start_timestamp = broadcast_start.broadcast_start_timestamp
      this.debuglog('broadcast start detected as ' + broadcast_start_timestamp + ', offset ' + broadcast_start_offset)

      let cache_data = await this.getGamedayData(contentId)

      // There are the events to ignore, if we're skipping breaks
      let break_types = ['Game Advisory', 'Pitching Substitution', 'Offensive Substitution', 'Defensive Sub', 'Defensive Switch', 'Runner Placed On Base']

      // There are the events to keep, in addition to the last event of each at-bat, if we're skipping pitches
      let action_types = ['Wild Pitch', 'Passed Ball', 'Stolen Base', 'Caught Stealing', 'Pickoff', 'Out', 'Balk', 'Defensive Indiff']

      let inning_offsets = [{start:broadcast_start_offset}]
      let event_offsets = [{start:0}]
      let last_event = 0
      let default_event_duration = 15

      // Pad times by these amounts
      let pad_start = 0
      let pad_end = 15
      let pad_adjust = 20

      // Inning counters
      let last_inning = 0
      let last_inning_half = ''

      // Loop through all plays
      for (var i=0; i < cache_data.liveData.plays.allPlays.length; i++) {

        // If requested, calculate inning offsets
        if ( skip_types.includes('innings') ) {
          // Look for a change from our inning counters
          if ( cache_data.liveData.plays.allPlays[i].about && cache_data.liveData.plays.allPlays[i].about.inning && ((cache_data.liveData.plays.allPlays[i].about.inning != last_inning) || (cache_data.liveData.plays.allPlays[i].about.halfInning != last_inning_half)) ) {
            let inning_index = cache_data.liveData.plays.allPlays[i].about.inning * 2
            // top
            if ( cache_data.liveData.plays.allPlays[i].about.halfInning == 'top' ) {
              inning_index = inning_index - 1
            }
            if ( typeof inning_offsets[inning_index] === 'undefined' ) inning_offsets.push({})
            for (var j=0; j < cache_data.liveData.plays.allPlays[i].playEvents.length; j++) {
              if ( cache_data.liveData.plays.allPlays[i].playEvents[j].details && cache_data.liveData.plays.allPlays[i].playEvents[j].details.event && (break_types.some(v => cache_data.liveData.plays.allPlays[i].playEvents[j].details.event.includes(v))) ) {
                // ignore break events
              } else {
                inning_offsets[inning_index].start = ((new Date(cache_data.liveData.plays.allPlays[i].playEvents[j].startTime) - broadcast_start_timestamp) / 1000) - pad_start + skip_adjust
                break
              }
            }
            // Update inning counters
            last_inning = cache_data.liveData.plays.allPlays[i].about.inning
            last_inning_half = cache_data.liveData.plays.allPlays[i].about.halfInning
          }
        }

        // Get event offsets, if necessary
        if ( skip_types.includes('breaks') || skip_types.includes('pitches') ) {

          // Loop through play events, looking for actions
          let actions = []
          for (var j=0; j < cache_data.liveData.plays.allPlays[i].playEvents.length; j++) {
            // If skipping breaks, everything is an action except break types
            // otherwise, only action types are included (skipping pitches)
            if ( skip_types.includes('breaks') ) {
              if ( cache_data.liveData.plays.allPlays[i].playEvents[j].details && cache_data.liveData.plays.allPlays[i].playEvents[j].details.event && (break_types.some(v => cache_data.liveData.plays.allPlays[i].playEvents[j].details.event.includes(v))) ) {
                // ignore break events
              } else {
                actions.push(j)
              }
            } else if ( cache_data.liveData.plays.allPlays[i].playEvents[j].details && cache_data.liveData.plays.allPlays[i].playEvents[j].details.event && (action_types.some(v => cache_data.liveData.plays.allPlays[i].playEvents[j].details.event.includes(v))) ) {
              actions.push(j)
            }
          }

          // Process breaks
          if ( skip_types.includes('breaks') ) {
            let this_event = {}
            let event_in_atbat = false
            for (var x=0; x < actions.length; x++) {
              let this_pad_start = 0
              let this_pad_end = 0
              // Once we define each event's start time, we won't change it
              if ( typeof this_event.start === 'undefined' ) {
                this_event.start = ((new Date(cache_data.liveData.plays.allPlays[i].playEvents[actions[x]].startTime) - broadcast_start_timestamp) / 1000) - pad_start + skip_adjust
                // For events within at-bats, adjust the padding
                if ( event_in_atbat ) {
                  this_event.start -= pad_adjust
                }
              }
              // Update the end time, if available
              if ( cache_data.liveData.plays.allPlays[i].playEvents[actions[x]].endTime ) {
                this_event.end = ((new Date(cache_data.liveData.plays.allPlays[i].playEvents[actions[x]].endTime) - broadcast_start_timestamp) / 1000) + pad_end + skip_adjust
              // Otherwise use the start time to estimate the end time
              } else {
                this_event.end = ((new Date(cache_data.liveData.plays.allPlays[i].playEvents[actions[x]].startTime) - broadcast_start_timestamp) / 1000) + this_pad_end + skip_adjust + default_event_duration
              }
              // Check if we have skipped a play event (indicating a break inside an at-bat), in which case push this event and start another one
              if ( (x > 0) && (actions[x] > (actions[x-1]+1)) && (typeof this_event.end !== 'undefined') ) {
                  // For events within at-bats, adjust the padding
                  event_in_atbat = true
                  this_event.end += pad_adjust
                  event_offsets.push(this_event)
                  this_event = {}
              }
            }
            // Once we've finished our loop through a play's events, push the event as long as we got an end time
            if ( typeof this_event.end !== 'undefined' ) {
              event_offsets.push(this_event)
            }
          } else if ( skip_types.includes('pitches') ) {
            // If we're skipping pitches, but we didn't detect any action events, use the last play event
            if ( (cache_data.liveData.plays.allPlays[i].playEvents.length > 0) && ((actions.length == 0) || (actions[(actions.length-1)] < (cache_data.liveData.plays.allPlays[i].playEvents.length-1))) ) {
              actions.push(cache_data.liveData.plays.allPlays[i].playEvents.length-1)
            }
            // Loop through the actions
            for (var x=0; x < actions.length; x++) {
              let this_event = {}
              let this_pad_start = pad_start
              let this_pad_end = pad_end
              // For events within at-bats, adjust the padding
              if ( x < (actions.length-1) ) {
                this_pad_start += pad_adjust
                this_pad_end -= pad_adjust
              }
              this_event.start = ((new Date(cache_data.liveData.plays.allPlays[i].playEvents[actions[x]].startTime) - broadcast_start_timestamp) / 1000) - this_pad_start + skip_adjust
              // If play event end time is available, set it and push this event
              if ( cache_data.liveData.plays.allPlays[i].playEvents[actions[x]].endTime ) {
                this_event.end = ((new Date(cache_data.liveData.plays.allPlays[i].playEvents[actions[x]].endTime) - broadcast_start_timestamp) / 1000) + this_pad_end + skip_adjust
              // Otherwise use the start time to estimate the end time
              } else {
                this_event.end = ((new Date(cache_data.liveData.plays.allPlays[i].playEvents[actions[x]].startTime) - broadcast_start_timestamp) / 1000) + this_pad_end + skip_adjust + default_event_duration
              }
              event_offsets.push(this_event)
            }
          }
        }
      }

      if ( skip_types.includes('innings') ) {
        this.debuglog('inning offsets: ' + JSON.stringify(inning_offsets))
      }
      this.temp_cache[contentId].inning_offsets = inning_offsets

      if ( skip_types.includes('breaks') || skip_types.includes('pitches') ) {
        this.debuglog('event offsets: ' + JSON.stringify(event_offsets))
      }
      this.temp_cache[contentId].event_offsets = event_offsets

      return true
    } catch(e) {
      this.log('getEventOffsets error : ' + e.message)
    }
  }

  // Get Big Inning schedule, if available
  async getBigInningSchedule(dateString = false) {
    try {
      this.debuglog('getBigInningSchedule')

      let currentDate = new Date()
      if ( !this.cache || !this.cache.bigInningScheduleCacheExpiry || (currentDate > new Date(this.cache.bigInningScheduleCacheExpiry)) ) {
        if ( !this.cache.bigInningSchedule ) this.cache.bigInningSchedule = {}
        let reqObj = {
          url: 'https://www.mlb.com/live-stream-games/big-inning',
          headers: {
            'User-Agent': USER_AGENT,
            'Origin': 'https://www.mlb.com',
            'Referer': 'https://www.mlb.com',
            'Accept-Encoding': 'gzip, deflate, br'
          },
          gzip: true
        }
        var response = await this.httpGet(reqObj)
        if ( response ) {
          // disabled because it's very big!
          //this.debuglog(response)
          // break HTML into array based on table rows
          var rows = response.split('<tr>')
          // start iterating at 2 (after header row)
          for (var i=2; i<rows.length; i++) {
            // split HTML row into array with columns
            let cols = rows[i].split('<td>')

            // define some variables that persist for each row
            let parts
            let year
            let month
            let day
            let this_datestring
            let add_date = 0
            let d

            for (var j=1; j<cols.length; j++) {
              // split on closing bracket to get column text at resulting array index 0
              let col = cols[j].split('<')
              switch(j){
                // first column is date
                case 1:
                  // split date into array
                  parts = col[0].split(' ')
                  year = parts[2]
                  // get month index, zero-based
                  month = new Date(Date.parse(parts[0] +" 1, 2021")).getMonth()
                  day = parts[1].substring(0,parts[1].length-3)
                  this_datestring = new Date(year, month, day).toISOString().substring(0,10)
                  this.cache.bigInningSchedule[this_datestring] = {}
                  // increment month index (not zero-based)
                  month += 1
                  break
                // remaining columns are times
                default:
                  let hour
                  let minute = '00'
                  let ampm
                  // if time has colon, split into array on that to get hour and minute parts
                  if ( col[0].indexOf(':') > 0 ) {
                    parts = col[0].split(':')
                    hour = parseInt(parts[0])
                    minute = parts[1].substring(0,2)
                  } else {
                    hour = parseInt(col[0].substring(0,col[0].length-2))
                  }
                  ampm = col[0].substring(col[0].length-2,col[0].length)
                  // convert hour to 24-hour format
                  if ( (ampm == 'PM') || ((hour == 12) && (ampm == 'AM')) ) {
                    hour += 12
                  }
                  // these times are EDT so add 4 for UTC
                  hour += 4
                  // if hour is beyond 23, note we will have to add 1 day
                  if ( hour > 23 ) {
                    add_date = 1
                    hour -= 24
                  }

                  d = new Date(this_datestring + 'T' + hour.toString().padStart(2, '0') + ':' + minute.toString().padStart(2, '0') + ':00.000+00:00')
                  d.setDate(d.getDate()+add_date)
                  switch(j){
                    // 2nd column is start time
                    case 2:
                      this.cache.bigInningSchedule[this_datestring].start = d
                      break
                    // 3rd column is end time
                    case 3:
                      this.cache.bigInningSchedule[this_datestring].end = d
                      break
                  }
                  break
              }
            }
          }
          this.debuglog(JSON.stringify(this.cache.bigInningSchedule))

          // Default cache period is 1 day from now
          let oneDayFromNow = new Date()
          oneDayFromNow.setDate(oneDayFromNow.getDate()+1)
          let cacheExpiry = oneDayFromNow
          this.cache.bigInningScheduleCacheExpiry = cacheExpiry

          this.save_cache_data()
        } else {
          this.log('error : invalid response from url ' + getObj.url)
        }
      } else {
        this.debuglog('using cached big inning schedule')
      }
      // If we requested the schedule for a specific date, and it exists, return it
      if ( dateString ) {
        if ( this.cache.bigInningSchedule && this.cache.bigInningSchedule[dateString] ) {
          return this.cache.bigInningSchedule[dateString]
        }
      }
    } catch(e) {
      this.log('getBigInningSchedule error : ' + e.message)
    }
  }

  // Get Big Inning URL, used to determine the stream URL if available
  async getBigInningURL() {
    try {
      this.debuglog('getBigInningURL')

      let cache_data
      let currentDate = new Date()
      if ( !this.cache || !this.cache.bigInningURLCacheExpiry || (currentDate > new Date(this.cache.bigInningURLCacheExpiry)) ) {
        let reqObj = {
          url: 'https://dapi.cms.mlbinfra.com/v2/content/en-us/vsmcontents/live-now-mlb-big-inning',
          headers: {
            'User-Agent': USER_AGENT,
            'Origin': 'https://www.mlb.com',
            'Referer': 'https://www.mlb.com',
            'Content-Type': 'application/json',
            'Accept-Encoding': 'gzip, deflate, br'
          },
          gzip: true
        }
        var response = await this.httpGet(reqObj)
        if ( this.isValidJson(response) ) {
          this.debuglog(response)
          cache_data = JSON.parse(response)

          // Default cache period is 1 day from now
          let oneDayFromNow = new Date()
          oneDayFromNow.setDate(oneDayFromNow.getDate()+1)
          let cacheExpiry = oneDayFromNow

          let today = this.liveDate()

          if ( cache_data.title && (cache_data.title == 'LIVE NOW: MLB Big Inning') ) {
            this.debuglog('active big inning url')
            this.cache.bigInningURL = cache_data.references.video[0].fields.url

            if ( this.cache.bigInningSchedule[today] && (currentDate < this.cache.bigInningSchedule[today].end ) ) {
              let scheduledEnd = new Date(this.cache.bigInningSchedule[today].end)
              scheduledEnd.setHours(scheduledEnd.getHours()+1)
              this.debuglog('setting cache expiry to scheduled end plus 1 hour: ' + scheduledEnd)
              cacheExpiry = scheduledEnd
            } else {
              // if it's not in our schedule, we can find the end time by parsing the time from the slug text, then adding the duration
              let slug_array = cache_data.references.video[0].slug.split('-')
              let et_hour = parseInt(slug_array[0])
              let et_minute
              if ( slug_array[1].indexOf('pm') ) {
                et_minute = slug_array[1].replace('pm','')
                et_hour += 12
                if ( et_hour == 24 ) et_hour = 0
              } else {
                et_minute = slug_array[1].replace('am','')
              }
              let scheduledEnd = new Date(today + 'T' + et_hour.toString().padStart(2,'0') + ':' + et_minute.padStart(2,'0') + ':00.000-04:00')

              let duration_array = cache_data.references.video[0].fields.duration.split(':')
              scheduledEnd.setHours(scheduledEnd.getHours()+(parseInt(duration_array[0])-1))
              scheduledEnd.setMinutes(scheduledEnd.getMinutes()+parseInt(duration_array[1]))

              this.debuglog('setting cache expiry to duration: ' + scheduledEnd.toISOString())
              cacheExpiry = scheduledEnd
            }
          } else {
            this.debuglog('no active big inning url')
            this.cache.bigInningURL = ''
            // check when next big inning is scheduled to start, within 5 days
            let counter = 5
            let checkDate = today
            await this.getBigInningSchedule()
            while ( counter < 5 ) {
              if ( this.cache.bigInningSchedule[checkDate] && (currentDate < this.cache.bigInningSchedule[checkDate].start ) ) {
                this.debuglog('setting cache expiry to next scheduled start: ' + this.cache.bigInningSchedule[checkDate].start)
                cacheExpiry = this.cache.bigInningSchedule[checkDate].start
                break
              }
              checkDate = new Date(checkDate).setDate(checkDate.getDate()+1).toISOString().substring(0,10)
              counter++
            }
          }

          // finally save the setting
          this.cache.bigInningURLCacheExpiry = cacheExpiry
          this.save_cache_data()
        } else {
          this.log('error : invalid json from url ' + getObj.url)
        }
      }
      if ( this.cache.bigInningURL != '' ) {
        return this.cache.bigInningURL
      }
    } catch(e) {
      this.log('getBigInningURL error : ' + e.message)
    }
  }

  // Get Big Inning stream URL
  async getBigInningStreamURL() {
    this.debuglog('getBigInningStreamURL')
    if ( this.cache.bigInningStreamURL && this.cache.bigInningURLExpiry && (currentDate < new Date(this.cache.bigInningURLCacheExpiry)) ) {
      this.log('using cached bigInningStreamURL')
      return this.cache.bigInningStreamURL
    } else {
      var playbackURL = await this.getBigInningURL()
      if ( !playbackURL ) {
        this.debuglog('no active big inning url')
      } else {
        this.debuglog('getBigInningStreamURL from ' + playbackURL)
        let reqObj = {
          url: playbackURL,
          simple: false,
          headers: {
            'Authorization': 'Bearer ' + await this.getOktaAccessToken() || this.halt('missing OktaAccessToken'),
            'User-agent': USER_AGENT,
            'Accept': '*/*',
            'Origin': 'https://www.mlb.com',
            'Referer': 'https://www.mlb.com/',
            'Accept-Encoding': 'gzip, deflate, br'
          },
          gzip: true
        }
        var response = await this.httpGet(reqObj)
        if ( this.isValidJson(response) ) {
          this.debuglog('getBigInningStreamURL response : ' + response)
          let obj = JSON.parse(response)
          if ( obj.success && (obj.success == true) ) {
            this.debuglog('found bigInningStreamURL : ' + obj.data[0].value)
            this.cache.bigInningStreamURL = obj.data[0].value
            this.save_cache_data()
            return this.cache.bigInningStreamURL
          } else {
            this.log('getBigInningStreamURL error')
            this.log(obj.errorCode)
            this.log(obj.message)
            return
          }
        } else if ( response.startsWith('#EXTM3U') ) {
          this.debuglog('getBigInningStreamURL is bigInningURL : ' + playbackURL)
          this.cache.bigInningStreamURL = playbackURL
          this.save_cache_data()
          return this.cache.bigInningStreamURL
        }
      }
    }
  }

}

module.exports = sessionClass