#!/usr/bin/env node

// Set Node dependencies
var request = require('request-promise')
var url = require('url')
var crypto = require('crypto')
var root = require('root')
var minimist = require('minimist')
var fs = require('fs')
var readlineSync = require('readline-sync')
var FileCookieStore = require('tough-cookie-filestore')

// Get command line arguments, if specified:
// --port or -p (defaults to 9999)
// --debug or -d (false if not specified)
// --version or -v (returns package version number)
var argv = minimist(process.argv, {
  alias: {p:'port', d:'debug', v:'version'},
  booleans: ['debug']
})
if (argv.version) return console.error(require('./package').version)

// Default user agent for fetching schedule, playlists, and video segments
const user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.181 Safari/537.36'

// Valid resolutions, default is adaptive
// note that 720p_alt is 60 fps, all others are 30 fps
const valid_resolutions = [ 'adaptive', '180p', '216p', '288p', '360p', '504p', '540p', '720p', '720p_alt' ]

// Valid audio tracks, default is all
const valid_audio_tracks = [ 'all', 'English', 'Natural Sound', 'English Radio', 'Radio Española' ]

// Team IDs
const team_ids = {'ari':'109',
                  'atl':'144',
                  'bal':'110',
                  'bos':'111',
                  'chc':'112',
                  'cws':'145',
                  'cin':'113',
                  'cle':'114',
                  'col':'115',
                  'det':'116',
                  'hou':'117',
                  'kc':'118',
                  'laa':'108',
                  'lad':'119',
                  'mia':'146',
                  'mil':'158',
                  'min':'142',
                  'nym':'121',
                  'nyy':'147',
                  'oak':'133',
                  'phi':'143',
                  'pit':'134',
                  'stl':'138',
                  'sd':'135',
                  'sf':'137',
                  'sea':'136',
                  'tb':'139',
                  'tex':'140',
                  'tor':'141',
                  'was':'120'};
const team_id_list = 'ari, atl, bal, bos, chc, cws, cin, cle, col, det, hou, kc, laa, lad, mia, mil, min, nym, nyy, oak, phi, pit:, stl, sd, sf, sea, tb, tex, tor, was'

// Declare web server
var app = root()

// Get app's base directory
global.__basedir = __dirname;

// Create cookies json file if it doesn't exist
var cookiepath = __basedir + "/cookies.json"
if(!fs.existsSync(cookiepath)){
    fs.closeSync(fs.openSync(cookiepath, 'w'))
}
// Set up cookie store
var jar = request.jar(new FileCookieStore(cookiepath))
request = request.defaults({timeout:15000, agent:false, jar: request.jar()})

// Read credentials json file if it exists
var credentials = { username: '', password: '', device_id: '' }
var credentialspath = __basedir + "/credentials.json"
if(fs.existsSync(credentialspath)){
  credentials = JSON.parse(fs.readFileSync(credentialspath))
}
// Get username and password (and generate random UUID for device_id) if not yet specified, and write to credentials json file
if ( (credentials['username'] == '') || (credentials['password'] == '') ) {
  credentials['username'] = readlineSync.question('Enter username (email address): ')
  credentials['password'] = readlineSync.question('Enter password: ', {
    hideEchoBack: true
  })
  credentials['default_team'] = readlineSync.question('Enter default team (' + team_id_list + '): ')
  credentials['device_id'] = getRandomString(8) + '-' + getRandomString(4) + '-' + getRandomString(4) + '-' + getRandomString(4) + '-' + getRandomString(12)
  fs.writeFileSync(credentialspath, JSON.stringify(credentials))
}

// Response array placeholders
var login = {'token':null,'expires':null}
var access = {'token':null,'expires':null}
var loginpath = __basedir + "/login.json"
if(fs.existsSync(loginpath)){
  login = JSON.parse(fs.readFileSync(loginpath))
}
/*var accesspath = __basedir + "/access.json"
if(fs.existsSync(accesspath)){
  access = JSON.parse(fs.readFileSync(accesspath))
}*/

// Authorization header placeholder
var my_authorization_headers = {
      'Authorization': null,
      'User-Agent': user_agent
}

// Log function for debugging
var log = function(msg) {
  if (argv.debug) console.log(msg)
}

// Store previous key, for return without decoding
var prevUrl
var prevKey
var getKey = function(url, headers, cb) {
  if (url == prevUrl) return cb(null, prevKey)

  log('key request : ' + url)
  requestRetry(url, {headers:my_authorization_headers, encoding:null}, function(err, response) {
    if (err) return cb(err)
    prevKey = response.body
    prevUrl = url
    cb(null, response.body)
  })
}

// Default respond function, for adjusting content-length and updating CORS headers
var respond = function(proxy, res, body) {
  delete proxy.headers['content-length']
  delete proxy.headers['transfer-encoding']
  delete proxy.headers['content-md5']
  delete proxy.headers['connection']
  delete proxy.headers['access-control-allow-credentials']

  proxy.headers['content-length'] = body.length
  proxy.headers['access-control-allow-origin'] = '*'

  res.writeHead(proxy.statusCode, proxy.headers)
  res.end(body)
}

// Retry request function, up to 10 times
var requestRetry = function(u, opts, cb) {
  var tries = 10
  var action = function() {
    request(u, opts, function(err, res) {
      if (err) {
        if (tries-- > 0) return setTimeout(action, 1000)
        return cb(err)
      }
      cb(err, res)
    })
  }

  action()
}

// Start web server listening on port
app.listen(argv.port || 9999, function(addr) {
  console.log('Listening on http://'+addr)
})

// Redirect root url to the live-stream-games (schedule) page
//app.get('/', '/live-stream-games')
app.get('/', function(req, res) {
  body = '<htm><head><title>mlbserver</title></head><body><h1>mlbserver</h1>' + "\n"

  body += '<p><a href="/live-stream-games">MLB.TV Media Center</a></p>' + "\n"

  body += '<p>Default team: ' + credentials['default_team'] + '<br>' + "\n" +
         '<a href="/v">watch today</a> | <a href="/v?date=' + new Date(new Date().setDate(new Date().getDate()-1)).toISOString().substring(0, 10) + '">watch yesterday</a></p>'  + "\n"

  body += '<p>Watch today for:<br>' + "\n"
  for (key in team_ids) {
    body += '<a href="/v?team=' + key + '">' + key + '</a><br>' + "\n"
  }
  body += '</p>' + "\n"

  body += '<p>Force resolution examples: '
  for (key in valid_resolutions) {
  body += '<a href="/v?resolution=' + valid_resolutions[key] + '">' + valid_resolutions[key] + '</a> | '
  }
  body += "\n" + '<p>Force audio track examples: '
  for (key in valid_audio_tracks) {
  body += '<a href="/v?audio_track=' + valid_audio_tracks[key] + '">' + valid_audio_tracks[key] + '</a> | '
  }
  body += '</p>' + "\n"

  body += '<p>To log out, delete files "credentials.json" and "login.json" in folder "' + __basedir + '" on your server</p>' + "\n" +
          '</body></html>'

  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end(body)
})

// Listen for live-stream-games (schedule) page requests, return the page after local url substitution
app.get('/live-stream-games*', function(req, res) {
  log('schedule request : ' + req.url)

  var schedule_url = 'https://www.mlb.com' + req.url
  var schedule_header = {
        'User-Agent': user_agent
  }

  var req = function () {
    requestRetry(schedule_url, {headers:schedule_header}, function(err, response) {
      if (err) return res.error(err)

      var body = response.body

      // a regex substitution to change existing media player links to local hls.js embed urls
      body = body.replace(/https:\/\/www.mlb.com\/tv\/g\d+\/[v]([a-zA-Z0-9-]+)/g,"/embed?src=%2Fvideo%3Fid%3D$1")

      respond(response, res, Buffer.from(body))
    })
  }

  return req()

  requestRetry(schedule_url, {headers:schedule_header}, function(err, res) {
    if (err) return res.error(err)
    req()
  })
})

// Listen for OPTIONS requests and respond with CORS headers
app.options('*', function(req, res) {
  log('OPTIONS request : ' + req.url)
  var cors_headers = {
  	'access-control-allow-headers': 'Origin, X-Requested-With, Content-Type, accessToken, Authorization, Accept, Range',
  	'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-max-age': 0
  }
  res.writeHead(204, cors_headers)
  res.end()
  return
})

// Listen for embed request, response with embedded hls.js player and video request
app.get('/embed', function(req, res) {
  log('embed request : ' + req.url)

  delete req.headers.host

  log('embed src : ' + req.query.src)

  // body is just hls.js demo player with local http instead of https and absolute urls
  // demo player url: https://video-dev.github.io/hls.js/demo/
  var body = '<html><head><link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.4/css/bootstrap.min.css"> <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.4/css/bootstrap-theme.min.css"> <link rel="stylesheet" href="https://video-dev.github.io/hls.js/demo/style.css"> <script src="https://ajax.googleapis.com/ajax/libs/jquery/2.1.3/jquery.min.js"></script> <script src="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.4/js/bootstrap.min.js"></script> <script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/1.3.3/FileSaver.min.js"></script></head><body><div class="main-container"> <header class="wrapper clearfix"> <h1> <a target="_blank" href="https://github.com/video-dev/hls.js"> <img src="https://cloud.githubusercontent.com/assets/616833/19739063/e10be95a-9bb9-11e6-8100-2896f8500138.png"/> </a> </h1> <h2 class="title"> demo </h2> <h3> <a href="../docs/API.html">API docs | usage guide</a> </h3> </header> </div><div class="main-container"> <header> <p> Test your HLS streams in all supported browsers (Chrome/Firefox/IE11/Edge/Safari). </p><p> Advanced controls are available at the bottom of this page. </p><p> <b>Looking for a more <i>basic</i> usage example? Go <a href="basic-usage.html">here</a>.</b><br></p></header> <div id="controls"> <div id="customButtons"></div><select id="streamSelect" class="innerControls"> <option value="" selected>Select a test-stream from drop-down menu. Or enter custom URL below</option> </select> <input id="streamURL" class="innerControls" type=text value=""/> <label class="innerControls"> Enable streaming: <input id="enableStreaming" type=checkbox checked/> </label> <label class="innerControls"> Auto-recover media-errors: <input id="autoRecoverError" type=checkbox checked/> </label> <label class="innerControls"> Enable worker for transmuxing: <input id="enableWorker" type=checkbox checked/> </label> <label class="innerControls"> Dump transmuxed fMP4 data: <input id="dumpfMP4" type=checkbox unchecked/> </label> <label class="innerControls"> Widevine DRM license-server URL: <input id="widevineLicenseUrl" style="width: 50%"/> </label> <label class="innerControls"> Level-capping (max limit): <input id="levelCapping" style="width: 8em" type=number/> </label> <label class="innerControls"> Default audio-codec: <input style="width: 8em" id="defaultAudioCodec"/> </label> <label class="innerControls"> Metrics history (max limit, -1 is unlimited): <input id="limitMetrics" style="width: 8em" type=number/> </label> <label class="innerControls"> Player size: <select id="videoSize" style="float:right;"> <option value="240">Tiny (240p)</option> <option value="384">Small (384p)</option> <option value="480">Medium (480p)</option> <option value="720" selected>Large (720p)</option> <option value="1080">Huge (1080p)</option> </select> </label> <label class="innerControls"> Current video-resolution: <span id="currentResolution">/</span> </label> <label class="innerControls"> Permalink:&nbsp; <span id="StreamPermalink" style="width: 50%"></span> </label> </div><video id="video" controls autoplay class="videoCentered"></video> <br><canvas id="bufferedCanvas" height="15" class="videoCentered" onclick="onClickBufferedRange(event);"></canvas> <br><br><label class="center">Status:</label> <pre id="statusOut" class="center" style="white-space: pre-wrap;"></pre> <label class="center">Error:</label> <pre id="errorOut" class="center" style="white-space: pre-wrap;"></pre> <div class="center" style="text-align: center;" id="toggleButtons"> <button type="button" class="btn btn-sm" onclick="toggleTab(\'playbackControlTab\');">Playback</button> <button type="button" class="btn btn-sm" onclick="toggleTab(\'qualityLevelControlTab\');">Quality-levels</button> <button type="button" class="btn btn-sm" onclick="toggleTab(\'audioTrackControlTab\');">Audio-tracks</button> <button type="button" class="btn btn-sm" onclick="toggleTab(\'statsDisplayTab\');">Buffer &amp; Statistics</button> <button type="button" class="btn btn-sm" onclick="toggleTab(\'metricsDisplayTab\'); showMetrics();">Real-time metrics</button> </div><div class="center" id=\'playbackControlTab\'> <h4>Playback</h4> <center> <p> <button type="button" class="btn btn-sm btn-info" onclick="$(\'#video\')[0].play()">Play</button> <button type="button" class="btn btn-sm btn-info" onclick="$(\'#video\')[0].pause()">Pause</button> </p><p> <button type="button" class="btn btn-sm btn-info" onclick="$(\'#video\')[0].currentTime-=10">- 10 s</button> <button type="button" class="btn btn-sm btn-info" onclick="$(\'#video\')[0].currentTime+=10">+ 10 s</button> </p><p> <button type="button" class="btn btn-sm btn-info" onclick="$(\'#video\')[0].currentTime=$(\'#seek_pos\').val()">Seek to </button> <input type="text" id=\'seek_pos\' size="8" onkeydown="if(window.event.keyCode==\'13\'){$(\'#video\')[0].currentTime=$(\'#seek_pos\').val();}"> </p><p> <button type="button" class="btn btn-xs btn-warning" onclick="hls.attachMedia($(\'#video\')[0])">Attach media</button> <button type="button" class="btn btn-xs btn-warning" onclick="hls.detachMedia()">Detach media</button> </p><p> <button type="button" class="btn btn-xs btn-warning" onclick="hls.startLoad()">Start loading</button> <button type="button" class="btn btn-xs btn-warning" onclick="hls.stopLoad()">Stop loading</button> </p><p> <button type="button" class="btn btn-xs btn-warning" onclick="hls.recoverMediaError()">Recover media-error</button> </p><p> <button type="button" class="btn btn-xs btn-warning" onclick="createfMP4(\'audio\');">Create audio-fmp4</button> <button type="button" class="btn btn-xs btn-warning" onclick="createfMP4(\'video\')">Create video-fmp4</button> </p></center> </div><div class="center" id=\'qualityLevelControlTab\'> <h4>Quality-levels</h4> <center> <table> <tr> <td> <p>Currently played level:</p></td><td> <div id="currentLevelControl" style="display: inline;"></div></td></tr><tr> <td> <p>Next level loaded:</p></td><td> <div id="nextLevelControl" style="display: inline;"></div></td></tr><tr> <td> <p>Currently loaded level:</p></td><td> <div id="loadLevelControl" style="display: inline;"></div></td></tr><tr> <td> <p>Cap-limit level (maximum):</p></td><td> <div id="levelCappingControl" style="display: inline;"></div></td></tr></table> </center> </div><div class="center" id=\'audioTrackControlTab\'> <h4>Audio-tracks</h4> <table> <tr> <td>Current audio-track:</td><td width=10px>None selected</td><td> <div id="audioTrackControl" style="display: inline;"></div></td></tr></table> </div><div class="center" id=\'metricsDisplayTab\'> <h4>Real-time metrics</h4> <div id="metricsButton"> <button type="button" class="btn btn-xs btn-info" onclick="$(\'#metricsButtonWindow\').toggle();$(\'#metricsButtonFixed\').toggle();windowSliding=!windowSliding; refreshCanvas()">toggle sliding/fixed window</button><br><div id="metricsButtonWindow"> <button type="button" class="btn btn-xs btn-info" onclick="timeRangeSetSliding(0)">window ALL</button> <button type="button" class="btn btn-xs btn-info" onclick="timeRangeSetSliding(2000)">2s</button> <button type="button" class="btn btn-xs btn-info" onclick="timeRangeSetSliding(5000)">5s</button> <button type="button" class="btn btn-xs btn-info" onclick="timeRangeSetSliding(10000)">10s</button> <button type="button" class="btn btn-xs btn-info" onclick="timeRangeSetSliding(20000)">20s</button> <button type="button" class="btn btn-xs btn-info" onclick="timeRangeSetSliding(30000)">30s</button> <button type="button" class="btn btn-xs btn-info" onclick="timeRangeSetSliding(60000)">60s</button> <button type="button" class="btn btn-xs btn-info" onclick="timeRangeSetSliding(120000)">120s</button><br><button type="button" class="btn btn-xs btn-info" onclick="timeRangeZoomIn()">Window Zoom In</button> <button type="button" class="btn btn-xs btn-info" onclick="timeRangeZoomOut()">Window Zoom Out</button><br><button type="button" class="btn btn-xs btn-info" onclick="timeRangeSlideLeft()"> <<< Window Slide </button> <button type="button" class="btn btn-xs btn-info" onclick="timeRangeSlideRight()">Window Slide >>> </button><br></div><div id="metricsButtonFixed"> <button type="button" class="btn btn-xs btn-info" onclick="windowStart=$(\'#windowStart\').val()">fixed window start(ms)</button> <input type="text" id=\'windowStart\' defaultValue="0" size="8" onkeydown="if(window.event.keyCode==\'13\'){windowStart=$(\'#windowStart\').val();}"> <button type="button" class="btn btn-xs btn-info" onclick="windowEnd=$(\'#windowEnd\').val()">fixed window end(ms)</button> <input type="text" id=\'windowEnd\' defaultValue="10000" size="8" onkeydown="if(window.event.keyCode==\'13\'){windowEnd=$(\'#windowEnd\').val();}"><br></div><button type="button" class="btn btn-xs btn-success" onclick="goToMetrics()" style="font-size:18px">metrics link</button> <button type="button" class="btn btn-xs btn-success" onclick="goToMetricsPermaLink()" style="font-size:18px">metrics permalink</button> <button type="button" class="btn btn-xs btn-success" onclick="copyMetricsToClipBoard()" style="font-size:18px">copy metrics to clipboard</button> <canvas id="bufferTimerange_c" width="640" height="100" style="border:1px solid #000000" onmousedown="timeRangeCanvasonMouseDown(event)" onmousemove="timeRangeCanvasonMouseMove(event)" onmouseup="timeRangeCanvasonMouseUp(event)" onmouseout="timeRangeCanvasonMouseOut(event);"></canvas> <canvas id="bitrateTimerange_c" width="640" height="100" style="border:1px solid #000000;"></canvas> <canvas id="bufferWindow_c" width="640" height="100" style="border:1px solid #000000" onmousemove="windowCanvasonMouseMove(event);"></canvas> <canvas id="videoEvent_c" width="640" height="15" style="border:1px solid #000000;"></canvas> <canvas id="loadEvent_c" width="640" height="15" style="border:1px solid #000000;"></canvas><br></div></div><div class="center" id=\'statsDisplayTab\'> <h4>Buffer &amp; Statistics</h4> <label>Buffer state:</label> <pre id="bufferedOut"></pre> <label>General stats:</label> <pre id=\'statisticsOut\'></pre> </div></div><footer> <br><br><br><br><br><br></footer> <script src="https://video-dev.github.io/hls.js/demo/canvas.js"></script> <script src="https://video-dev.github.io/hls.js/demo/metrics.js"></script> <script src="https://video-dev.github.io/hls.js/demo/jsonpack.js"></script> <script src="https://video-dev.github.io/hls.js/dist/hls.js"></script> <script src="https://video-dev.github.io/hls.js/dist/hls-demo.js"></script></body></html>'
  res.end(body)
})

// Redirect v to video (shortcut)
app.get('/v', '/video')

// Listen for video request, log in and get tokens if necessary, then ultimately get the master playlist from the derived stream url
app.get('/video', async function(req, res) {
  delete req.headers.host

  log('video request : ' + req.url)

  // type not yet implemented (default video 0, audio 2)
  var type = req.query.type || 0
  var team = req.query.team || credentials['default_team']
  var team_id = team_ids[team]
  var date = req.query.date || new Date().toISOString().substring(0, 10)
  var content_id = req.query.id || await get_content_id(team_id, date, type)
  var resolution = req.query.resolution || 'adaptive'
  var audio_track = req.query.audio_track || 'all'

  try {
    var newlogin = false
    if ((login['token'] == null) || (login['expires'] < new Date())) {
      log('Logging in...')
      newlogin = true
      var login_response = await get_login_token(credentials['username'], credentials['password'])
      var obj = JSON.parse(login_response)
      login['token'] = obj.access_token
      log('Login token : ' + login['token'])
      login['expires'] = new Date(new Date().getTime() + obj.expires_in*1000)
      fs.writeFileSync(loginpath, JSON.stringify(login))
    }

    if ((newlogin) || (access['token'] == null) || (access['expires'] < new Date())) {
      log('Getting access token...')
      var media_entitlement = await get_media_entitlement(login['token'])
      log('Media entitlement : ' + media_entitlement)
      var access_response = JSON.parse(await get_access_token(media_entitlement))
      access['token'] = access_response.access_token
      my_authorization_headers['Authorization'] = access['token']
      log('Access token : ' + access['token'])
      access['expires'] = new Date(new Date().getTime() + access_response.expires_in*1000)
      //fs.writeFileSync(accesspath, JSON.stringify(access))
    }

    var playback_url = await get_playback_url(access['token'], content_id)
    log('playback_url : ' + playback_url)
    var stream_url = await get_stream_url(access['token'], playback_url)
    log('stream_url (master playlist) : ' + stream_url)

    get_master_playlist(stream_url, req, res, resolution, audio_track)
  }catch (e){
    //handle errors as needed
    console.error(e.message)
  }
})

// Get the master playlist from the stream_url
function get_master_playlist(stream_url, req, res, resolution, audio_track) {
  var req = function () {
    requestRetry(stream_url, {headers:my_authorization_headers}, function(err, response) {
      if (err) return res.error(err)

      var body = response.body.trim().split('\n')

      // Check if resolution and audio_track are valid
      if ( !valid_resolutions.includes(resolution) ) {
        resolution = valid_resolutions[0]
      }
      if ( !valid_audio_tracks.includes(audio_track) ) {
        audio_track = valid_audio_tracks[0]
      }

      // Some variables for controlling audio/video stream selection, if specified
      var video_track_matched = false
      var frame_rate = '29.97'
      if ( resolution !== 'adaptive' ) {
        if ( resolution.slice(4) === '_alt' ) {
          frame_rate = '59.94'
        }
        resolution = resolution.slice(0, 3)
      }

      body = body
        .map(function(line) {
          // Omit keyframe tracks
          if (line.indexOf('#EXT-X-I-FRAME-STREAM-INF:') === 0) {
            return
          }

          // Parse audio tracks to only include matching one, if specified
          if (line.indexOf('#EXT-X-MEDIA:TYPE=AUDIO') === 0) {
            if ( (audio_track != 'all') && (line.indexOf('NAME="'+audio_track+'"') > 0) ) {
              line = line.replace('AUTOSELECT=NO','AUTOSELECT=YES')
              line = line.replace('AUTOSELECT=YES','AUTOSELECT=YES,DEFAULT=YES')
            } else if ( (audio_track != 'all') && (line.indexOf('NAME="'+audio_track+'"') === -1) ) {
              return
            }
            if (line.indexOf(',URI=') > 0) {
              var parsed = line.match(/URI="([^"]+)"?$/)
              return line.replace(parsed[1],'playlist?url='+encodeURIComponent(url.resolve(stream_url, parsed[1])))
            } else {
              return line
            }
          }

          // Parse video tracks to only include matching one, if specified
          if (line.indexOf('#EXT-X-STREAM-INF:BANDWIDTH=') === 0) {
            if ( resolution === 'adaptive' ) {
              return line
            } else {
              if (line.indexOf(resolution+',FRAME-RATE='+frame_rate) > 0) {
                video_track_matched = true
                return line
              } else {
                return
              }
            }
          }

          if (line[0] === '#') return line

          if ( (resolution === 'adaptive') || (video_track_matched) ) {
            video_track_matched = false
            return 'playlist?url='+encodeURIComponent(url.resolve(stream_url, line.trim()))
          }
        })
        .filter(function(line) {
          return line
        })
        .join('\n')+'\n'

      respond(response, res, Buffer.from(body))
    })
  }

  return req()

  requestRetry(stream_url, {headers:my_authorization_headers}, function(err, res) {
    if (err) return res.error(err)
    req()
  })
}

// Listen for playlist requests
app.get('/playlist', function(req, res) {
  log('playlist request : ' + req.url)

  delete req.headers.host

  var u = req.query.url
  log('playlist url : ' + u)

  var req = function () {
    requestRetry(u, {headers:my_authorization_headers}, function(err, response) {
      if (err) return res.error(err)

      var body = response.body.trim().split('\n')
      var key
      var iv

      body = body
        .map(function(line) {
          if (line.indexOf('#EXT-X-KEY:METHOD=AES-128') === 0) {
            var parsed = line.match(/URI="([^"]+)"(?:,IV=(.+))?$/)
            key = parsed[1]
            if (parsed[2]) iv = parsed[2].slice(2).toLowerCase()
            return null
          }

          if (line[0] === '#') return line

          return 'ts?url='+encodeURIComponent(url.resolve(u, line.trim()))+'&key='+encodeURIComponent(key)+'&iv='+encodeURIComponent(iv)
        })
        .filter(function(line) {
          return line
        })
        .join('\n')+'\n'

      respond(response, res, Buffer.from(body))
    })
  }

  return req()

  requestRetry(u, {headers:my_authorization_headers}, function(err, res) {
    if (err) return res.error(err)
    req()
  })
})

// Listen for ts requests (video segments) and decode them
app.get('/ts', function(req, res) {
  log('ts request : ' + req.url)

  delete req.headers.host

  var u = req.query.url
  log('ts url : ' + u)

  requestRetry(u, {headers:my_authorization_headers, encoding:null}, function(err, response) {
    if (err) return res.error(err)
    if (!req.query.key) return respond(response, res, response.body)

    //var ku = url.resolve(manifest, req.query.key)
    var ku = req.query.key
    getKey(ku, req.headers, function(err, key) {
      if (err) return res.error(err)

      var iv = Buffer.from(req.query.iv, 'hex')
      log('iv : 0x'+req.query.iv)

      var dc = crypto.createDecipheriv('aes-128-cbc', key, iv)
      var buffer = Buffer.concat([dc.update(response.body), dc.final()])

      respond(response, res, buffer)
    })
  })
})

// 0. get content id using team id, date, and content type (default video 0 or audio 2)
function get_content_id(team_id, this_date, content_type=0) {
  return new Promise((resolve, reject) => {
    request.get({
      url: "http://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=" + this_date + "&endDate=" + this_date + "&teamId=" + team_id + "&hydrate=game(content(media(epg)))",
      headers: {
        'User-Agent': 'okhttp/3.12.1'
      }
    })
    .then(function (body) {
      var obj = JSON.parse(body)
      var temparray = obj.dates[0].games[0].content.media.epg[content_type].items
      var content_id = temparray[0]['contentId']
      for (var i = 0; i < temparray.length; i++) {
        if ( temparray[i]['mediaFeedSubType'] == team_id ) {
          content_id = temparray[i]['contentId']
          break
        }
      }
      resolve(content_id)
    })
    .catch(function (err) {
      console.error(err)
    })
  })
}

// 1. get login token
function get_login_token(account_username, account_password) {
  return new Promise((resolve, reject) => {
    request.post({
      url: 'https://ids.mlb.com/oauth2/aus1m088yK07noBfh356/v1/token',
      //url: 'https://postman-echo.com/post',
      headers: {
        'User-Agent': 'okhttp/3.12.1'
      },
      form: {
        grant_type: 'password',
        username: account_username,
        password: account_password,
        scope: 'openid offline_access',
        client_id: '0oa3e1nutA1HLzAKG356'
      }
    })
    .then(function (body) {
      resolve(body)
    })
    .catch(function (err) {
      console.error(err)
    })
  })
}

// 2. get media entitlement using login token
function get_media_entitlement(login_token) {
  return new Promise((resolve, reject) => {
    request.get({
      url: 'https://media-entitlement.mlb.com/api/v3/jwt',
      qs: { os: 'Android', appname: 'AtBat', did: credentials['device_id'] },
      headers: {
        'User-Agent': 'okhttp/3.12.1',
        'Authorization': 'Bearer ' + login_token
      }
    })
    .then(function (body) {
      resolve(body)
    })
    .catch(function (err) {
      console.error(err)
    })
  })
}

// 3. get access token using media entitlement
function get_access_token(media_entitlement) {
  return new Promise((resolve, reject) => {
    request.post({
      url: 'https://us.edge.bamgrid.com/token',
      headers: {
        'User-Agent': 'okhttp/3.12.1',
        'Accept': 'application/json',
        'Authorization': 'Bearer bWxidHYmYW5kcm9pZCYxLjAuMA.6LZMbH2r--rbXcgEabaDdIslpo4RyZrlVfWZhsAgXIk'
      },
      form: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: media_entitlement,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        platform: 'android-tv'
      }
    })
    .then(function (body) {
      resolve(body)
    })
    .catch(function (err) {
      console.error(err)
    })
  })
}

// 4. get playback url using access token and content id
function get_playback_url(access_token, content_id) {
  return new Promise((resolve, reject) => {
    request.get({
      url: 'https://search-api-mlbtv.mlb.com/svc/search/v2/graphql/persisted/query/core/Airings',
      qs: { variables: '%7B%22contentId%22%3A%22' + content_id + '%22%7D' },
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + access_token,
        'X-BAMSDK-Version': 'v4.3.0',
        'X-BAMSDK-Platform': 'android-tv',
        'User-Agent': 'BAMSDK/v4.3.0 (mlbaseball-7993996e 8.1.0; v2.0/v4.3.0; android; tv)'
      }
    })
    .then(function (body) {
      var obj = JSON.parse(body)
      var href = obj.data.Airings[0].playbackUrls[0].href
      resolve(href.substring(0, href.length - 10))
    })
    .catch(function (err) {
      console.error(err)
    })
  })
}

// 5. get stream url using access token and playback url
function get_stream_url(access_token, playback_url) {
  return new Promise((resolve, reject) => {
    request.get({
      url: playback_url + 'browser~csai',
    headers: {
      'Accept': 'application/vnd.media-service+json; version=2',
      'Authorization': access_token,
      'X-BAMSDK-Version': 'v3.0',
      'X-BAMSDK-Platform': 'windows',
      'User-Agent': user_agent
      }
    })
    .then(function (body) {
      var obj = JSON.parse(body)
      resolve(obj.stream.complete)
    })
    .catch(function (err) {
      console.error(err)
    })
  })
}

// Get random string function, used to generate a UUID (device id)
function getRandomString(length) {
  var s = ''
  do { s += Math.random().toString(36).substr(2); } while (s.length < length);
  s = s.substr(0, length)

  return s
}
