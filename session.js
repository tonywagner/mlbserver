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
const MULTIVIEW_DIRECTORY = path.join(__dirname, 'multiview')

const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json')
const COOKIE_FILE = path.join(DATA_DIRECTORY, 'cookies.json')
const DATA_FILE = path.join(DATA_DIRECTORY, 'data.json')
const CACHE_FILE = path.join(CACHE_DIRECTORY, 'cache.json')

// Default user agent to use for API requests
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:87.0) Gecko/20100101 Firefox/87.0'

// Other variables to use in API communications
const PLATFORM = "macintosh"
const BAM_SDK_VERSION = '4.3'
const BAM_TOKEN_URL = 'https://us.edge.bamgrid.com/token'

class sessionClass {
  // Initialize the class
  constructor(debug = false) {
    this.debug = debug

    // Read credentials from file, if present
    this.credentials = this.readFileToJson(CREDENTIALS_FILE) || {}

    // Prompt for credentials if they don't exist
    if ( !this.credentials.username || !this.credentials.password ) {
      this.credentials.username = readlineSync.question('Enter username (email address): ')
      this.credentials.password = readlineSync.question('Enter password: ', { hideEchoBack: true })
      this.save_credentials()
    }

    // Create cookies json file if it doesn't exist
    this.createDirectory(DATA_DIRECTORY)
    this.createFile(COOKIE_FILE)

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

  // the live date is today's date, or if before a specified hour UTC time, then use yesterday's date
  liveDate(hour = 10) {
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

  convertDateStringToObjectName(dateString) {
    return 'd' + this.dateWithoutDashes(dateString)
  }

  getCacheUpdatedDate(dateString) {
    return this.cache.dates[this.convertDateStringToObjectName(dateString)].updated
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
    if ( !this.data.media ) {
      this.data.media = {}
    }
    if ( !this.data.media[mediaId] ) {
      this.data.media[mediaId] = {}
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
    this.data.media[mediaId].streamURL = streamURL
    this.data.media[mediaId].streamURLExpiry = Date.now() + 60*1000
    this.save_session_data()
  }

  markBlackoutError(mediaId) {
    this.createMediaCache(mediaId)
    this.log('saving blackout error to prevent repeated access attempts')
    this.data.media[mediaId].blackout = true
    this.save_session_data()
  }

  dateWithoutDashes(dateString) {
    return dateString.substr(0,4) + dateString.substr(5,2) + dateString.substr(8,2)
  }

  stringWithoutDashes(str) {
    return str.replace(/-/g, '')
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
      //this.halt('logout error : ' + e.message)
    }
  }

  clear_session_data() {
    try {
      fs.unlinkSync(COOKIE_FILE)
      fs.unlinkSync(DATA_FILE)
    } catch(e){
      //this.halt('reset session error : ' + e.message)
    }
  }

  clear_cache() {
    try {
      fs.unlinkSync(CACHE_FILE)
    } catch(e){
      //this.halt('clear cache error : ' + e.message)
    }
  }

  get_multiview_directory() {
    return MULTIVIEW_DIRECTORY
  }

  save_credentials() {
    this.writeJsonToFile(JSON.stringify(this.credentials), CREDENTIALS_FILE)
    this.debuglog('credentials saved to file')
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

  save_xml_cache_file(cache_name, cache_data) {
    this.createDirectory(CACHE_DIRECTORY)
    fs.writeFileSync(path.join(CACHE_DIRECTORY, cache_name+'.xml'), cache_data)
    this.debuglog('cache file saved')
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
  streamVideo(u, opts, cb) {
    opts.jar = this.jar
    opts.headers = {
      'Authorization': this.data.bamAccessToken,
      'User-Agent': USER_AGENT
    }
    this.request(u, opts, cb)
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
    if ( this.data.media && this.data.media[mediaId] && this.data.media[mediaId].streamURL && this.data.media[mediaId].streamURLExpiry && (Date.now() < this.data.media[mediaId].streamURLExpiry) ) {
      this.debuglog('using cached streamURL')
      return this.data.media[mediaId].streamURL
    } else if ( this.data.media && this.data.media[mediaId] && this.data.media[mediaId].blackout ) {
      this.log('mediaId previously blacked out, skipping')
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
        var parsed = str.match("data.access_token = '([^']+)'")
        if ( parsed && parsed[1] ) {
          let oktaAccessToken = parsed[1].split('\\x2D').join('-')
          this.debuglog('retrieveOktaAccessToken : ' + oktaAccessToken)
          return oktaAccessToken
        }
      }
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
          'username': this.credentials.username || this.halt('missing username'),
          'password': this.credentials.password || this.halt('missing password'),
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
  async getMediaId(team, mediaType, mediaDate) {
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
      let cache_data = await this.getDayData(gameDate)

      if ( (cache_data.totalGamesInProgress > 0) || (mediaDate) ) {
        let nationalCount = 0
        for (var j = 0; j < cache_data.dates[0].games.length; j++) {
          if ( mediaId ) break
          if ( cache_data.dates[0].games[j] && cache_data.dates[0].games[j].content && cache_data.dates[0].games[j].content.media && cache_data.dates[0].games[j].content.media.epg ) {
            for (var k = 0; k < cache_data.dates[0].games[k].content.media.epg.length; k++) {
              if ( mediaId ) break
              if ( cache_data.dates[0].games[j].content.media.epg[k].title == mediaType ) {
                for (var x = 0; x < cache_data.dates[0].games[j].content.media.epg[k].items.length; x++) {
                  if ( (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON') || ((mediaDate) && (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ARCHIVE')) ) {
                    if ( ((typeof cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType) == 'undefined') || (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType.indexOf('IN_MARKET_') == -1) ) {
                      if ( (team.indexOf('NATIONAL ') == 0) && (cache_data.dates[0].games[j].content.media.epg[k].items[x][mediaFeedType] == 'NATIONAL') ) {
                        nationalCount += 1
                        let nationalArray = team.split('.')
                        if ( (nationalArray.length == 2) && (nationalArray[1] == nationalCount) ) {
                          this.debuglog('matched active national live event')
                          mediaId = cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaId
                          contentId = cache_data.dates[0].games[j].content.media.epg[k].items[x].contentId
                          break
                        }
                      } else {
                        let teamType = cache_data.dates[0].games[j].content.media.epg[k].items[x][mediaFeedType].toLowerCase()
                        if ( (team == cache_data.dates[0].games[j].teams[teamType].team.abbreviation) ) {
                          this.debuglog('matched team for active live event')
                          mediaId = cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaId
                          contentId = cache_data.dates[0].games[j].content.media.epg[k].items[x].contentId
                          break
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

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

          // Default cache period is 1 hour
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
      if (cache_data) {
        return cache_data
      }
    } catch(e) {
      this.log('getHighlightsData error : ' + e.message)
    }
  }

  // get data for a day, either from cache or an API call
  async getDayData(dateString) {
    try {
      this.debuglog('getDayData for ' + dateString)

      let cache_data
      let cache_name = this.convertDateStringToObjectName(dateString)
      let cache_file = path.join(CACHE_DIRECTORY, dateString+'.json')
      let currentDate = new Date()
      if ( !fs.existsSync(cache_file) || !this.cache || !this.cache.dates || !this.cache.dates[cache_name] || !this.cache.dates[cache_name].dateCacheExpiry || (currentDate > new Date(this.cache.dates[cache_name].dateCacheExpiry)) ) {
        let reqObj = {
          url: 'https://bdfed.stitch.mlbinfra.com/bdfed/transform-mlb-scoreboard?stitch_env=prod&sortTemplate=2&sportId=1&startDate=' + dateString + '&endDate=' + dateString + '&gameType=E&&gameType=S&&gameType=R&&gameType=F&&gameType=D&&gameType=L&&gameType=W&&gameType=A&language=en&leagueId=104&&leagueId=103&contextTeamId=',
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
          this.save_json_cache_file(dateString, cache_data)

          // Default cache period is 1 hour
          let oneHourFromNow = new Date()
          oneHourFromNow.setHours(oneHourFromNow.getHours()+1)
          let cacheExpiry = oneHourFromNow

          let today = this.liveDate()
          let yesterday = this.yesterdayDate()
          if ( dateString == today ) {
            let finals = false
            for (var i = 0; i < cache_data.dates[0].games.length; i++) {
              if ( ((cache_data.dates[0].games[i].status.abstractGameState == 'Live') && (cache_data.dates[0].games[i].status.detailedState.indexOf('Suspended') != 0)) || ((cache_data.dates[0].games[i].status.startTimeTBD == true) && (cache_data.dates[0].games[i].status.abstractGameState != 'Final') && (cache_data.dates[0].games[i-1].status.abstractGameState == 'Final')) ) {
                this.debuglog('setting cache expiry to 1 minute due to in progress games or upcoming TBD game')
                currentDate.setMinutes(currentDate.getMinutes()+1)
                cacheExpiry = currentDate
                break
              } else if ( cache_data.dates[0].games[i].status.abstractGameState == 'Final' ) {
                finals = true
              } else if ( (finals == false) && (cache_data.dates[0].games[i].status.startTimeTBD == false) ) {
                let nextGameDate = new Date(cache_data.dates[0].games[i].gameDate)
                nextGameDate.setMinutes(nextGameDate.getMinutes()-15)
                this.debuglog('setting cache expiry to 15 minutes before next live game')
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
                    if ( ((((typeof cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedType) == 'undefined') || (cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedType.indexOf('IN_MARKET_') == -1)) && (((typeof cache_data.dates[i].games[j].content.media.epg[k].items[x].language) == 'undefined') || (cache_data.dates[i].games[j].content.media.epg[k].items[x].language != 'es'))) ) {
                      let teamType = cache_data.dates[i].games[j].content.media.epg[k].items[x][mediaFeedType]
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
                        if ( pipe == 'true' ) {
                          stream = 'pipe://ffmpeg -hide_banner -loglevel fatal -i "' + stream + '" -map 0:v -map 0:a -c copy -metadata service_provider="MLBTV" -metadata service_name="' + channelid + '" -f mpegts pipe:1'
                        }
                        let icon = server
                        if ( (teamType == 'NATIONAL') && ((includeTeams.length == 0) || ((includeTeams.length > 0) && includeTeams.includes(teamType))) ) {
                          icon += '/image.svg?teamId=MLB'
                          nationalChannels[channelid] = {}
                          nationalChannels[channelid].channellogo = icon
                          nationalChannels[channelid].stream = stream
                          nationalChannels[channelid].mediatype = mediaType
                        } else {
                          icon += '/image.svg?teamId=' + cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedSubType
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
                if ( mediaTitle == mediaType ) {
                  for (var x = 0; x < cache_data.dates[i].games[j].content.media.epg[k].items.length; x++) {
                    if ( ((((typeof cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedType) == 'undefined') || (cache_data.dates[i].games[j].content.media.epg[k].items[x].mediaFeedType.indexOf('IN_MARKET_') == -1)) && (((typeof cache_data.dates[i].games[j].content.media.epg[k].items[x].language) == 'undefined') || (cache_data.dates[i].games[j].content.media.epg[k].items[x].language != 'es'))) ) {
                      let teamType = cache_data.dates[i].games[j].content.media.epg[k].items[x][mediaFeedType]
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
  async getAiringsData(contentId, gamePk) {
    try {
      this.debuglog('getAiringsData')

      let cache_data
      let cache_name = this.stringWithoutDashes(contentId)
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

          // Default cache period is 1 hour
          let oneHourFromNow = new Date()
          oneHourFromNow.setHours(oneHourFromNow.getHours()+1)
          let cacheExpiry = oneHourFromNow

          let today = this.liveDate()
          let game_date = new Date(cache_data.data.Airings[0].startDate)

          if ( game_date.toLocaleString("en-CA").substring(0,10) == today ) {
            if ( (cache_data.data.Airings[0].mediaConfig.productType == 'LIVE') || ((typeof cache_data.data.Airings[0].milestones !== 'undefined') && (typeof cache_data.data.Airings[0].milestones[0] !== 'undefined') && (typeof cache_data.data.Airings[0].milestones[0].milestoneTime !== 'undefined') && (typeof cache_data.data.Airings[0].milestones[0].milestoneTime[0].start !== 'undefined') && ((cache_data.data.Airings[0].milestones[0].milestoneTime[0].start > 20*60) || (cache_data.data.Airings[0].milestones[0].milestoneTime[1].start > 20*60))) ) {
              this.debuglog('setting cache expiry to 5 minutes for live or untrimmed games today')
              currentDate.setMinutes(currentDate.getMinutes()+5)
              cacheExpiry = currentDate
            }
          } else if ( game_date.toLocaleString("en-CA").substring(0,10) < today ) {
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

  // Get data for a game (team data to determine Gameday URL)
  async getGameData(contentId) {
    try {
      this.debuglog('getGameData')

      let gamePk = await this.getGamePkFromContentId(contentId)

      let cache_data
      let cache_name = gamePk
      let cache_file = path.join(CACHE_DIRECTORY, cache_name+'.json')
      if ( !fs.existsSync(cache_file) ) {
        let reqObj = {
          url: 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePk=' + gamePk + '&hydrate=team',
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
          this.save_json_cache_file(gamePk, cache_data)
        } else {
          this.log('error : invalid response from url ' + getObj.url)
        }
      } else {
        this.debuglog('using cached game data')
        cache_data = this.readFileToJson(cache_file)
      }
      if (cache_data) {
        return cache_data
      }
    } catch(e) {
      this.log('getGameData error : ' + e.message)
    }
  }

  // Get gameday data for a game (pitch data)
  async getGamedayData(contentId) {
    try {
      this.debuglog('getGamedayData')

      let game_data = await this.getGameData(contentId)
      let game = {}
      game.year = game_data.dates[0].date.substring(0,4)
      game.month = game_data.dates[0].date.substring(5,7)
      game.day = game_data.dates[0].date.substring(8,10)
      game.away = game_data.dates[0].games[0].teams['away'].team.teamCode
      game.home = game_data.dates[0].games[0].teams['home'].team.teamCode
      game.game = game_data.dates[0].games[0].gameNumber

      let cache_data
      let cache_name = 'g' + game.year + game.month + game.day + game.away + game.home + game.game
      let cache_file = path.join(CACHE_DIRECTORY, cache_name+'.xml')
      let currentDate = new Date()
      if ( !fs.existsSync(cache_file) || !this.cache || !this.cache.gameday || !this.cache.gameday[cache_name] || !this.cache.gameday[cache_name].gamedayCacheExpiry || (currentDate > new Date(this.cache.gameday[cache_name].gamedayCacheExpiry)) ) {
        let reqObj = {
          url: 'http://gd2.mlb.com/components/game/mlb/year_' + game.year + '/month_' + game.month + '/day_' + game.day + '/gid_' + game.year + '_' + game.month + '_' + game.day + '_' + game.away + 'mlb_' + game.home + 'mlb_' + game.game + '/inning/inning_all.xml',
          headers: {
            'User-agent': USER_AGENT,
            'Origin': 'https://www.mlb.com',
            'Accept-Encoding': 'gzip, deflate, br'
          },
          gzip: true
        }
        var response = await this.httpGet(reqObj)
        if ( response ) {
          this.debuglog(response)
          cache_data = response
          this.save_xml_cache_file(cache_name, cache_data)

          // Default cache period is 1 hour
          let oneHourFromNow = new Date()
          oneHourFromNow.setHours(oneHourFromNow.getHours()+1)
          let cacheExpiry = oneHourFromNow

          if ( this.temp_cache[contentId].productType == 'LIVE' ) {
            this.debuglog('setting cache expiry to 5 minutes for live game')
            currentDate.setMinutes(currentDate.getMinutes()+5)
            cacheExpiry = currentDate
          } else {
            let today = this.liveDate()
            let gameday_date = game.year + '-' + game.month + '-' + game.day

            if ( gameday_date < today ) {
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
        cache_data = fs.readFileSync(cache_file)
      }
      if (cache_data) {
        return cache_data
      }
    } catch(e) {
      this.log('getGamedayData error : ' + e.message)
    }
  }

  // Get inning offsets into temporary cache
  async getInningOffsets(contentId) {
    try {
      this.debuglog('getInningOffsets')

      if ( !this.temp_cache[contentId] ) {
        this.temp_cache[contentId] = {}
      }

      let cache_data = await this.getAiringsData(contentId)
      // If VOD and we have fewer than 2 milestones, use the gamePk to look for more milestones in a different airing
      if ( cache_data.data.Airings[0].mediaConfig.productType && (cache_data.data.Airings[0].mediaConfig.productType == 'VOD') && cache_data.data.Airings[0].milestones && (cache_data.data.Airings[0].milestones.length < 2) ) {
        this.debuglog('too few milestones, looking for more')
        this.cache.airings[this.stringWithoutDashes(contentId)] = {}
        cache_data = await this.getAiringsData(contentId, cache_data.data.Airings[0].partnerProgramId)
      }

      let productType
      let inning_offsets = []
      let broadcast_start_timestamp
      // Pad times by these amounts
      let pad_start = 5
      let pad_end = 10
      // Assume this break length if times not available
      let break_length = 120
      if ( cache_data.data.Airings[0].mediaConfig.productType ) productType = cache_data.data.Airings[0].mediaConfig.productType
      if ( cache_data.data.Airings[0].milestones ) {
        for (var j = 0; j < cache_data.data.Airings[0].milestones.length; j++) {
          let offset_index = 1
          let offset
          if ( cache_data.data.Airings[0].milestones[j].milestoneTime[0].type == 'offset' ) {
            offset_index = 0
          }
          offset = cache_data.data.Airings[0].milestones[j].milestoneTime[offset_index].start

          // Broadcast start
          if ( j == 0 ) {
            inning_offsets.push({})
            inning_offsets[0].start = offset
            broadcast_start_timestamp = new Date(cache_data.data.Airings[0].milestones[j].milestoneTime[(offset_index == 0 ? 1 : 0)].startDatetime)
            this.debuglog('broadcast start time detected as ' + broadcast_start_timestamp)
            this.debuglog('adjusting by ' + offset)
            broadcast_start_timestamp.setSeconds(broadcast_start_timestamp.getSeconds()-offset)
            this.debuglog('new start time is ' + broadcast_start_timestamp)
            if ( cache_data.data.Airings[0].milestones[j].milestoneType == 'BROADCAST_START' ) {
              continue
            }
          }

          // Populate array with inning start and end times as available
          let inning_index
          let inning_number_index = 1
          if ( cache_data.data.Airings[0].milestones[j].keywords[0].type == 'inning' ) {
            inning_index = cache_data.data.Airings[0].milestones[j].keywords[0].value * 2
            inning_number_index = 0
          } else {
            inning_index = cache_data.data.Airings[0].milestones[j].keywords[1].value * 2
          }

          // top
          if ( cache_data.data.Airings[0].milestones[j].keywords[(inning_number_index == 0 ? 1 : 0)].value == 'true' ) {
            inning_index = inning_index - 1
          }
          if ( typeof inning_offsets[inning_index] === 'undefined' ) inning_offsets.push({})

          if ( cache_data.data.Airings[0].milestones[j].milestoneType == 'INNING_START' ) {
            inning_offsets[inning_index].start = offset - pad_start
          } else {
            inning_offsets[inning_index].end = offset + pad_end
            // If end time, fill in start time if it doesn't already exist
            if ( inning_index > 1 ) {
              if ( typeof inning_offsets[inning_index].start === 'undefined' ) {
                if ( typeof inning_offsets[inning_index-1].end !== 'undefined' ) {
                  inning_offsets[inning_index].start = inning_offsets[inning_index-1].end + break_length
                }
              }
            }
          }

          // Fill in previous end time if it doesn't already exist
          if ( inning_index > 1 ) {
            if ( typeof inning_offsets[inning_index-1].end === 'undefined' ) {
              inning_offsets[inning_index-1].end = inning_offsets[inning_index].start - break_length
            }
          }
        }

        this.temp_cache[contentId].productType = productType
        this.debuglog('inning offsets: ' + JSON.stringify(inning_offsets))
        this.temp_cache[contentId].inning_offsets = inning_offsets
        this.temp_cache[contentId].broadcast_start_timestamp = broadcast_start_timestamp
      }

      return true
    } catch(e) {
      this.log('getInningOffsets error : ' + e.message)
    }
  }

  // Get pitch offsets into temporary cache
  async getPitchOffsets(contentId) {
    try {
      this.debuglog('getPitchOffsets')

      let cache_data = await this.getGamedayData(contentId)

      let inning_types = ['top','bottom']
      let action_types = ['Wild Pitch', 'Passed Ball', 'Stolen Base', 'Caught Stealing', 'Pickoff', 'Out', 'Balk', 'Defensive Indiff']

      let broadcast_start_timestamp = this.temp_cache[contentId].broadcast_start_timestamp
      this.debuglog('broadcast start detected as ' + broadcast_start_timestamp)
      let pitch_offsets = [{start:0}]
      let last_event = 0

      // Pad times by these amounts
      let pad_start = 0
      let pad_end = 15

      parseString(cache_data, function (err, result) {
        for (var i=0; i < result.game.inning.length; i++) {
          for (var j=0; j < inning_types.length; j++) {
            if ( typeof result.game.inning[i][inning_types[j]] !== 'undefined' ) {
              let actions = []
              if ( typeof result.game.inning[i][inning_types[j]][0].action !== 'undefined' ) {
                for (var k=0; k < result.game.inning[i][inning_types[j]][0].action.length; k++) {
                  if ( action_types.some(v => result.game.inning[i][inning_types[j]][0].action[k]['$'].event.includes(v)) ) {
                    let this_action = {}
                    this_action.event_num = result.game.inning[i][inning_types[j]][0].action[k]['$'].event_num
                    this_action.pitch = result.game.inning[i][inning_types[j]][0].action[k]['$'].pitch
                    actions.push(this_action)
                  }
                }
              }
              let event_complete = false
              for (var k=0; k < result.game.inning[i][inning_types[j]][0].atbat.length; k++) {
                if (event_complete) {
                  event_complete = false
                  continue
                }
                let this_event = {}
                let pitch_index
                for (var x=0; x < actions.length; x++) {
                  if ( (actions[x].event_num > last_event) && (actions[x].event_num < result.game.inning[i][inning_types[j]][0].atbat[k]['$'].event_num) ) {
                    pitch_index = actions[x].pitch - 1
                    this_event.start = ((new Date(result.game.inning[i][inning_types[j]][0].atbat[k].pitch[pitch_index]['$'].tfs_zulu) - broadcast_start_timestamp) / 1000) - pad_start
                    if ( actions[x].pitch < result.game.inning[i][inning_types[j]][0].atbat[k].pitch.length ) {
                      pitch_index = actions[x].pitch
                      this_event.end = ((new Date(result.game.inning[i][inning_types[j]][0].atbat[k].pitch[pitch_index]['$'].tfs_zulu) - broadcast_start_timestamp) / 1000) + pad_end
                      pitch_offsets.push(this_event)
                      this_event = {}
                    } else {
                      this_event.end = ((new Date(result.game.inning[i][inning_types[j]][0].atbat[k]['$'].end_tfs_zulu) - broadcast_start_timestamp) / 1000) + pad_end
                      pitch_offsets.push(this_event)
                      this_event = {}
                      event_complete = true
                      break
                    }
                  }
                }
                if ( typeof result.game.inning[i][inning_types[j]][0].atbat[k].pitch !== 'undefined' ) {
                  pitch_index = result.game.inning[i][inning_types[j]][0].atbat[k].pitch.length - 1
                  this_event.start = ((new Date(result.game.inning[i][inning_types[j]][0].atbat[k].pitch[pitch_index]['$'].tfs_zulu) - broadcast_start_timestamp) / 1000) - pad_start
                  this_event.end = ((new Date(result.game.inning[i][inning_types[j]][0].atbat[k]['$'].end_tfs_zulu) - broadcast_start_timestamp) / 1000) + pad_end
                  pitch_offsets.push(this_event)
                  last_event = result.game.inning[i][inning_types[j]][0].atbat[k].pitch[pitch_index]['$'].event_num
                }
              }
            }
          }
        }
      });

      this.debuglog('pitch offsets: ' + JSON.stringify(pitch_offsets))
      this.temp_cache[contentId].pitch_offsets = pitch_offsets

      return true
    } catch(e) {
      this.log('getPitchOffsets error : ' + e.message)
    }
  }

}

module.exports = sessionClass