#!/usr/bin/env node

// index.js sets up web server and listens for and responds to URL requests

// Required Node packages
const minimist = require('minimist')
const root = require('root')
const path = require('path')
const url = require('url')
const assert = require('assert')
var crypto = require('crypto')

// More required Node packages, for multiview streaming
const HLSServer = require('hls-server')
const http = require('http')
const httpAttach = require('http-attach')
const ffmpeg = require('fluent-ffmpeg')

// Declare our session class for API activity, from the included session.js file
const sessionClass = require('./session.js')

// Define some valid variable values, the first one being the default
const VALID_DATES = [ 'today', 'yesterday' ]
const YESTERDAY_UTC_HOURS = 14 // UTC hours (EST + 4) to change home page default date from yesterday to today
const VALID_MEDIA_TYPES = [ 'Video', 'Audio', 'Spanish' ]
const VALID_LINK_TYPES = [ 'Embed', 'Stream', 'Chromecast', 'Advanced' ]
const VALID_START_FROM = [ 'Beginning', 'Live' ]
const VALID_INNING_HALF = [ '', 'top', 'bottom' ]
const VALID_INNING_NUMBER = [ '', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12' ]
const VALID_SCORES = [ 'Hide', 'Show' ]
const VALID_RESOLUTIONS = [ 'adaptive', '720p60', '720p', '540p', '504p', '360p', 'none'  ]
const DEFAULT_MULTIVIEW_RESOLUTION = '540p'
// Corresponding andwidths to display for above resolutions
const VALID_BANDWIDTHS = [ '', '6600k', '4160k', '2950k', '2120k', '1400k', '' ]
const VALID_AUDIO_TRACKS = [ 'all', 'English', 'English Radio', 'Radio Española', 'none' ]
const DEFAULT_MULTIVIEW_AUDIO_TRACK = 'English'
const VALID_SKIP = [ 'off', 'breaks', 'pitches' ]
const VALID_FORCE_VOD = [ 'off', 'on' ]

const SAMPLE_STREAM_URL = 'https://www.radiantmediaplayer.com/media/rmp-segment/bbb-abr-aes/playlist.m3u8'

// Process command line arguments, if specified:
// --port or -p (default 9999)
// --debug or -d (false if not specified)
// --logout or -l (logs out and clears session)
// --session or -s (clears session)
// --cache or -c (clears cache)
// --version or -v (returns package version number)
var argv = minimist(process.argv, {
  alias: {
    p: 'port',
    m: 'multiview_port',
    a: 'multiview_path',
    f: 'ffmpeg_path',
    e: 'ffmpeg_encoder',
    g: 'ffmpeg_logging',
    d: 'debug',
    l: 'logout',
    s: 'session',
    c: 'cache',
    v: 'version'
  },
  booleans: ['ffmpeg_logging', 'debug', 'logout', 'session', 'cache', 'version']
})

// Version
if (argv.version) return console.log(require('./package').version)

// Declare a session, pass arguments to it
var session = new sessionClass(argv)

// Clear cache (cache data, not images)
if (argv.cache) {
  session.log('Clearing cache...')
  session.clear_cache()
  session = new sessionClass(argv)
}

// Clear session
if (argv.session) {
  session.log('Clearing session data...')
  session.clear_session_data()
  session = new sessionClass(argv)
}

// Logout (also implies clearing session)
if (argv.logout) {
  session.log('Logging out...')
  session.logout()
  if (!argv.session) {
    session.clear_session_data()
  }
  session = new sessionClass(argv)
}

// Set FFMPEG path, download if necessary
const pathToFfmpeg = argv.ffmpeg_path || require('ffmpeg-static')
ffmpeg.setFfmpegPath(pathToFfmpeg)

// Set FFMPEG encoder, use libx264 if not specified
const ffmpegEncoder = argv.ffmpeg_encoder || 'libx264'

// Declare web server
var app = root()

// Get appname from directory
var appname = path.basename(__dirname)

// Declare server, will fill in IP and port next
var server = ''

// Multiview server variables
var hls_base = 'multiview'
var multiview_stream_name = 'master.m3u8'
var ffmpeg_command
var ffmpeg_status = false
var multiview_url

// Start web server listening on port
// and also multiview server on the next port
let port = argv.port || 9999
let multiview_port = argv.multiview_port || port + 1
app.listen(port, function(addr) {
  server = 'http://' + addr
  session.log(appname + ' started at ' + server)

  session.debuglog('multiview port ' + multiview_port)
  var multiview_server = server.replace(':' + port, ':' + multiview_port)
  multiview_url = multiview_server + '/' + hls_base + '/' + multiview_stream_name
  session.log('multiview server started at ' + multiview_url)
  session.clear_multiview_files()
})
var multiview_app = http.createServer()
var hls = new HLSServer(multiview_app, {
  path: '/' + hls_base,
  dir: session.get_multiview_directory()
})
function corsMiddleware (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next()
}
httpAttach(multiview_app, corsMiddleware)
multiview_app.listen(multiview_port)

// Listen for stream requests
app.get('/stream.m3u8', async function(req, res) {
  try {
    session.log('stream.m3u8 request : ' + req.url)

    let mediaId
    let contentId
    let streamURL
    let options = {}
    let urlArray = req.url.split('?')
    if ( (urlArray.length == 1) || ((session.data.scan_mode == 'on') && req.query.team) ) {
      // load a sample encrypted HLS stream
      session.log('loading sample stream')
      options.resolution = 'adaptive'
      streamURL = SAMPLE_STREAM_URL
    } else {
      if ( req.query.resolution && (options.resolution == 'best') ) {
        options.resolution = VALID_RESOLUTIONS[1]
      } else {
        options.resolution = session.returnValidItem(req.query.resolution, VALID_RESOLUTIONS)
      }
      options.audio_track = session.returnValidItem(req.query.audio_track, VALID_AUDIO_TRACKS)
      options.audio_url = req.query.audio_url || ''
      options.force_vod = req.query.force_vod || VALID_FORCE_VOD[0]

      options.inning_half = req.query.inning_half || VALID_INNING_HALF[0]
      options.inning_number = req.query.inning_number || VALID_INNING_NUMBER[0]
      options.skip = req.query.skip || VALID_SKIP[0]

      if ( req.query.src ) {
        streamURL = req.query.src
      } else {
        if ( req.query.contentId ) {
          contentId = req.query.contentId
        }
        if ( req.query.mediaId ) {
          mediaId = req.query.mediaId
        } else if ( req.query.contentId ) {
          mediaId = await session.getMediaIdFromContentId(contentId);
        } else if ( req.query.team ) {
          let mediaType = req.query.mediaType || VALID_MEDIA_TYPES[0]
          let mediaDate = req.query.date || false
          let mediaInfo = await session.getMediaId(decodeURIComponent(req.query.team), mediaType, mediaDate)
          if ( mediaInfo ) {
            mediaId = mediaInfo.mediaId
            contentId = mediaInfo.contentId
          } else {
            session.log('no matching game found ' + req.url)
          }
        }

        if ( !mediaId ) {
          session.log('failed to get mediaId : ' + req.url)
          res.end('')
          return
        } else {
          session.debuglog('mediaId : ' + mediaId)

          if ( (contentId) && ((options.inning_half != VALID_INNING_HALF[0]) || (options.inning_number != VALID_INNING_NUMBER[0]) || (options.skip != VALID_SKIP[0])) ) {
            options.contentId = contentId
            await session.getInningOffsets(contentId)
            if ( options.skip == 'pitches' ) {
              await session.getPitchOffsets(contentId)
            }
          }

          streamURL = await session.getStreamURL(mediaId)
        }
      }
    }

    if (streamURL) {
      session.debuglog('using streamURL : ' + streamURL)

      if ( streamURL.indexOf('master_radio_') > 0 ) {
        options.resolution = 'adaptive'
      }

      if ( req.query.audio_url && (req.query.audio_url != '') ) {
        options.audio_url = await session.getAudioPlaylistURL(req.query.audio_url)
      }

      getMasterPlaylist(streamURL, req, res, options)
    } else {
      session.log('failed to get streamURL : ' + req.url)
      res.end('')
      return
    }
  } catch (e) {
    session.log('stream request error : ' + e.message)
    res.end('')
  }
})

// Store previous keys, for return without decoding
var prevKeys = {}
var getKey = function(url, headers, cb) {
  if ( (typeof prevKeys[url] !== 'undefined') && (typeof prevKeys[url].key !== 'undefined') ) {
    return cb(null, prevKeys[url].key)
  }

  if ( typeof prevKeys[url] === 'undefined' ) prevKeys[url] = {}

  session.debuglog('key request : ' + url)
  requestRetry(url, {encoding:null}, function(err, response) {
    if (err) return cb(err)
    prevKeys[url].key = response.body
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

// Retry request function, up to 2 times
var requestRetry = function(u, opts, cb) {
  var tries = 2
  var action = function() {
    session.streamVideo(u, opts, tries, function(err, res) {
      if (err) {
        if ( tries < 2 ) session.log('try ' + (3 - tries) + ' for ' + u)
        if (tries-- > 0) return setTimeout(action, 1000)
        return cb(err)
      }
      cb(err, res)
    })
  }

  action()
}


// Get the master playlist from the stream URL
function getMasterPlaylist(streamURL, req, res, options = {}) {
  session.debuglog('getMasterPlaylist of streamURL : ' + streamURL)
  var req = function () {
    requestRetry(streamURL, {}, function(err, response) {
      if (err) return res.error(err)

      session.debuglog(response.body)

      var body = response.body.trim().split('\n')

      let resolution = options.resolution || VALID_RESOLUTIONS[0]
      let audio_track = options.audio_track || VALID_AUDIO_TRACKS[0]
      let audio_url = options.audio_url || ''
      let force_vod = options.force_vod || VALID_FORCE_VOD[0]

      let inning_half = options.inning_half || VALID_INNING_HALF[0]
      let inning_number = options.inning_number || VALID_INNING_NUMBER[0]
      let skip = options.skip || VALID_SKIP[0]
      let contentId = options.contentId || false

      if ( (inning_number > 0) && (inning_half == VALID_INNING_HALF[0]) ) {
        inning_half = VALID_INNING_HALF[1]
      }

      // Some variables for controlling audio/video stream selection, if specified
      var video_track_matched = false
      var audio_track_matched = false
      var frame_rate = '29.97'
      if ( (resolution != 'adaptive') && (resolution != 'none') ) {
        if ( resolution.slice(4) === '60' ) {
          frame_rate = '59.94'
        }
        resolution = resolution.slice(0, 3)
      }

      body = body
      .map(function(line) {
        let newurl = ''

        // Omit keyframe tracks
        if (line.indexOf('#EXT-X-I-FRAME-STREAM-INF:') === 0) {
          return
        }

        // Omit captions track when no video is specified
        if ( (resolution == 'none') && (line.indexOf('#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,') === 0) ) {
          return
        }

        // Parse audio tracks to only include matching one, if specified
        if (line.indexOf('#EXT-X-MEDIA:TYPE=AUDIO') === 0) {
          if ( audio_track_matched ) return
          if ( audio_url != '' ) {
            audio_track_matched = true
            return '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="Alternate Audio",AUTOSELECT=YES,DEFAULT=YES,URI="' + audio_url + '"'
          }
          if ( audio_track == 'none') return
          if ( (resolution == 'none') && (line.indexOf(',URI=') < 0) ) return
          if ( (audio_track != 'all') && ((line.indexOf('NAME="'+audio_track+'"') > 0) || (line.indexOf('NAME="'+audio_track.substring(0,audio_track.length-1)+'"') > 0)) ) {
            audio_track_matched = true
            line = line.replace('AUTOSELECT=NO','AUTOSELECT=YES')
            if ( line.indexOf(',DEFAULT=YES') < 0 ) line = line.replace('AUTOSELECT=YES','AUTOSELECT=YES,DEFAULT=YES')
          } else if ( (audio_track != 'all') && ((line.indexOf('NAME="'+audio_track+'"') === -1) || (line.indexOf('NAME="'+audio_track.substring(0,audio_track.length-1)+'"') === -1)) ) {
            return
          }
          if (line.indexOf(',URI=') > 0) {
            if ( line.match ) {
              //var parsed = line.match(/URI="([^"]+)"?$/)
              var parsed = line.match(',URI="([^"]+)"')
              if ( parsed[1] ) {
                newurl = 'playlist?url='+encodeURIComponent(url.resolve(streamURL, parsed[1].trim()))
                if ( force_vod != VALID_FORCE_VOD[0] ) newurl += '&force_vod=on'
                if ( inning_half != VALID_INNING_HALF[0] ) newurl += '&inning_half=' + inning_half
                if ( inning_number != VALID_INNING_NUMBER[0] ) newurl += '&inning_number=' + inning_number
                if ( skip != VALID_SKIP[0] ) newurl += '&skip=' + skip
                if ( contentId ) newurl += '&contentId=' + contentId
                if ( resolution == 'none' ) {
                  audio_track_matched = true
                  return line.replace(parsed[0],'') + "\n" + '#EXT-X-STREAM-INF:BANDWIDTH=50000,CODECS="mp4a.40.2",AUDIO="aac"' + "\n" + newurl
                }
                return line.replace(parsed[1],newurl)
              }
            }
          }
        }

        // Parse video tracks to only include matching one, if specified
        if (line.indexOf('#EXT-X-STREAM-INF:BANDWIDTH=') === 0) {
          if ( resolution == 'none' ) {
            return
          } else {
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
        }

        // Skip key in archive master playlists
        if (line.indexOf('#EXT-X-SESSION-KEY:METHOD=AES-128') === 0) {
          return
        }

        if (line[0] === '#') {
          return line
        }

        if ( (resolution === 'adaptive') || (video_track_matched) ) {
          video_track_matched = false
          newurl = encodeURIComponent(url.resolve(streamURL, line.trim()))
          if ( force_vod != VALID_FORCE_VOD[0] ) newurl += '&force_vod=on'
          if ( inning_half != VALID_INNING_HALF[0] ) newurl += '&inning_half=' + inning_half
          if ( inning_number != VALID_INNING_NUMBER[0] ) newurl += '&inning_number=' + inning_number
          if ( skip != VALID_SKIP[0] ) newurl += '&skip=' + skip
          if ( contentId ) newurl += '&contentId=' + contentId
          return 'playlist?url='+newurl
        }
      })
      .filter(function(line) {
        return line
      })
      .join('\n')+'\n'

      session.debuglog(body)
      respond(response, res, Buffer.from(body))
    })
  }

  return req()

  requestRetry(streamURL, {}, function(err, res) {
    if (err) return res.error(err)
    req()
  })
}


// Listen for playlist requests
app.get('/playlist', function(req, res) {
  session.debuglog('playlist request : ' + req.url)

  delete req.headers.host

  var u = req.query.url
  session.debuglog('playlist url : ' + u)

  var force_vod = req.query.force_vod || VALID_FORCE_VOD[0]
  var inning_half = req.query.inning_half || VALID_INNING_HALF[0]
  var inning_number = req.query.inning_number || VALID_INNING_NUMBER[0]
  var skip = req.query.skip || VALID_SKIP[0]
  var contentId = req.query.contentId || false

  var req = function () {
    requestRetry(u, {}, function(err, response) {
      if (err) return res.error(err)

      //session.debuglog(response.body)

      var body = response.body.trim().split('\n')
      var key
      var iv

      if ( (contentId) && ((inning_half != VALID_INNING_HALF[0]) || (inning_number != VALID_INNING_NUMBER[0]) || (skip != VALID_SKIP[0]))) {
        // If inning offsets don't exist, we'll force those options off
        if ( (typeof session.temp_cache[contentId] === 'undefined') || (typeof session.temp_cache[contentId].inning_offsets === 'undefined') ) {
          inning_half = VALID_INNING_HALF[0]
          inning_number = VALID_INNING_NUMBER[0]
          skip = 'off'
        } else {
          var time_counter = 0.0
          var skip_index = 1
          var skip_next = false
          var discontinuity = false

          var offsets = session.temp_cache[contentId].inning_offsets
          if ( (skip == 'pitches') && (typeof session.temp_cache[contentId].pitch_offsets !== 'undefined') ) offsets = session.temp_cache[contentId].pitch_offsets
        }
      }

      body = body
      .map(function(line) {
        if ( ((skip != 'off') || (inning_half != VALID_INNING_HALF[0]) || (inning_number != VALID_INNING_NUMBER[0])) && (typeof session.temp_cache[contentId] !== 'undefined') && (typeof session.temp_cache[contentId].inning_offsets !== 'undefined') ) {
          if ( skip_next ) {
            skip_next = false
            return null
          }

          if (line.indexOf('#EXTINF:') == 0) {
            time_counter += parseFloat(line.substring(8, line.length-1))

            if ( (inning_half != VALID_INNING_HALF[0]) || (inning_number != VALID_INNING_NUMBER[0]) ) {
              let inning_index = 0
              if ( inning_number > 0 ) {
                inning_index = (inning_number * 2)
                if ( inning_half == 'top' ) inning_index = inning_index - 1
              }
              if ( (typeof session.temp_cache[contentId].inning_offsets[inning_index] !== 'undefined') && (typeof session.temp_cache[contentId].inning_offsets[inning_index].start !== 'undefined') && (time_counter < session.temp_cache[contentId].inning_offsets[inning_index].start) ) {
                session.debuglog('skipping ' + time_counter + ' before ' + session.temp_cache[contentId].inning_offsets[inning_index].start)
                skip_next = true
                if ( discontinuity ) {
                  return null
                } else {
                  discontinuity = true
                  return '#EXT-X-DISCONTINUITY'
                }
              } else {
                session.debuglog('inning start time not found or duplicate request made, ignoring: ' + u)
                inning_half = VALID_INNING_HALF[0]
                inning_number = VALID_INNING_NUMBER[0]
              }
            }

            if ( (skip != VALID_SKIP[0]) && (inning_half == VALID_INNING_HALF[0]) && (inning_number == VALID_INNING_NUMBER[0]) ) {
              let skip_this = true
              if ( (typeof offsets[skip_index] !== 'undefined') && (typeof offsets[skip_index].start !== 'undefined') && (typeof offsets[skip_index].end !== 'undefined') && (time_counter > offsets[skip_index].start) && (time_counter > offsets[skip_index].end) ) {
                skip_index++
              }
              if ( (typeof offsets[skip_index] === 'undefined') || (typeof offsets[skip_index].start === 'undefined') || (typeof offsets[skip_index].end === 'undefined') || ((time_counter > offsets[skip_index].start) && (time_counter < offsets[skip_index].end)) ) {
                session.debuglog('keeping ' + time_counter)
                skip_this = false
              } else {
                session.debuglog('skipping ' + time_counter)
              }
              if ( skip_this ) {
                skip_next = true
                if ( discontinuity ) {
                  return null
                } else {
                  discontinuity = true
                  return '#EXT-X-DISCONTINUITY'
                }
              } else {
                discontinuity = false
              }
            }
          }
        }

        if (line.indexOf('-KEY:METHOD=AES-128') > 0) {
          var parsed = line.match(/URI="([^"]+)"(?:,IV=(.+))?$/)
          if ( parsed ) {
            if ( parsed[1].substr(0,4) == 'http' ) key = parsed[1]
            else key = url.resolve(u, parsed[1])
            if (parsed[2]) iv = parsed[2].slice(2).toLowerCase()
          }
          return null
        }

        if (line[0] === '#') return line

        if ( key ) return 'ts?url='+encodeURIComponent(url.resolve(u, line.trim()))+'&key='+encodeURIComponent(key)+'&iv='+encodeURIComponent(iv)
        else return 'ts?url='+encodeURIComponent(url.resolve(u, line.trim()))
      })
      .filter(function(line) {
        return line
      })
      .join('\n')+'\n'

      if ( force_vod != VALID_FORCE_VOD[0] ) body += '#EXT-X-ENDLIST' + '\n'
      session.debuglog(body)
      respond(response, res, Buffer.from(body))
    })
  }

  return req()

  requestRetry(u, {}, function(err, res) {
    if (err) return res.error(err)
    req()
  })
})

// Listen for ts requests (video segments) and decode them
app.get('/ts', function(req, res) {
  session.debuglog('ts request : ' + req.url)

  delete req.headers.host

  var u = req.query.url
  session.debuglog('ts url : ' + u)

  requestRetry(u, {encoding:null}, function(err, response) {
    if (err) return res.error(err)
    if (!req.query.key) return respond(response, res, response.body)

    //var ku = url.resolve(manifest, req.query.key)
    var ku = req.query.key
    getKey(ku, req.headers, function(err, key) {
      if (err) return res.error(err)

      var iv = Buffer.from(req.query.iv, 'hex')
      session.debuglog('iv : 0x'+req.query.iv)

      var dc = crypto.createDecipheriv('aes-128-cbc', key, iv)
      var buffer = Buffer.concat([dc.update(response.body), dc.final()])

      respond(response, res, buffer)
    })
  })
})

// Server homepage, base URL
app.get('/', async function(req, res) {
  try {
    session.debuglog('homepage request : ' + req.url)

    let gameDate = session.liveDate()
    let todayUTCHours = session.getTodayUTCHours()
    if ( req.query.date ) {
      if ( req.query.date == VALID_DATES[1] ) {
        gameDate = session.yesterdayDate()
      } else if ( req.query.date != VALID_DATES[0] ) {
        gameDate = req.query.date
      }
    } else {
      let curDate = new Date()
      let utcHours = curDate.getUTCHours()
      if ( (utcHours >= todayUTCHours) && (utcHours < YESTERDAY_UTC_HOURS) ) {
        gameDate = session.yesterdayDate()
      }
    }
    var cache_data = await session.getDayData(gameDate)

    var linkType = VALID_LINK_TYPES[0]
    if ( req.query.linkType ) {
      linkType = req.query.linkType
      session.setLinkType(linkType)
    }
    var startFrom = VALID_START_FROM[0]
    if ( req.query.startFrom ) {
      startFrom = req.query.startFrom
    }
    var scores = VALID_SCORES[0]
    if ( req.query.scores ) {
      scores = req.query.scores
    }
    var mediaType = VALID_MEDIA_TYPES[0]
    if ( req.query.mediaType ) {
      mediaType = req.query.mediaType
    }
    var resolution = VALID_RESOLUTIONS[0]
    if ( req.query.resolution ) {
      resolution = req.query.resolution
    }
    var audio_track = VALID_AUDIO_TRACKS[0]
    if ( req.query.audio_track ) {
      audio_track = req.query.audio_track
    }
    var force_vod = VALID_FORCE_VOD[0]
    if ( req.query.force_vod ) {
      force_vod = req.query.force_vod
    }
    var inning_half = VALID_INNING_HALF[0]
    if ( req.query.inning_half ) {
      inning_half = req.query.inning_half
    }
    var inning_number = VALID_INNING_NUMBER[0]
    if ( req.query.inning_number ) {
      inning_number = req.query.inning_number
    }
    var skip = VALID_SKIP[0]
    if ( req.query.skip ) {
      skip = req.query.skip
    }
    var audio_url = ''
    if ( req.query.audio_url ) {
      audio_url = req.query.audio_url
    }

    var scan_mode = session.data.scan_mode
    if ( req.query.scan_mode && (req.query.scan_mode != session.data.scan_mode) ) {
      scan_mode = req.query.scan_mode
      session.setScanMode(req.query.scan_mode)
    }

    var body = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-type" content="text/html;charset=UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no"><title>' + appname + '</title><link rel="icon" href="favicon.svg"><style type="text/css">input[type=text],input[type=button]{-webkit-appearance:none;-webkit-border-radius:0}body{width:480px;color:lightgray;background-color:black;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:none}a{color:darkgray}button{color:lightgray;background-color:black}button.default{color:black;background-color:lightgray}table{width:100%;pad}table,th,td{border:1px solid darkgray;border-collapse:collapse}th,td{padding:5px}.tinytext,textarea,input[type="number"]{font-size:.8em}textarea{width:380px}'

    // Highlights CSS
    //max-height:calc(100vh-110px);
    body += '.modal{display:none;position:fixed;z-index:1;padding-top:100px;left:0;top:0;width:100%;height:100%;overflow:auto;-webkit-overflow-scrolling:touch;background-color:rgb(0,0,0);background-color:rgba(0,0,0,0.4)}.modal-content{background-color:#fefefe;margin:auto;padding:10px;border:1px solid #888;width:360px;color:black}#highlights a{color:black}.close{color:black;float:right;font-size:28px;font-weight:bold;}#highlights a:hover,#highlights a:focus,.close:hover,.close:focus{color:gray;text-decoration:none;cursor:pointer;}'

    // Tooltip CSS
    body += '.tooltip{position:relative;display:inline-block;border-bottom: 1px dotted gray;}.tooltip .tooltiptext{font-size:.8em;visibility:hidden;width:360px;background-color:gray;color:white;text-align:left;padding:5px;border-radius:6px;position:absolute;z-index:1;top:100%;left:75%;margin-left:-30px;}.tooltip:hover .tooltiptext{visibility:visible;}'

    body += '</style><script type="text/javascript">' + "\n";

    // Define option variables in page
    body += 'var date="' + gameDate + '";var mediaType="' + mediaType + '";var resolution="' + resolution + '";var audio_track="' + audio_track + '";var audio_url="' + audio_url + '";var force_vod="' + force_vod + '";var inning_half="' + inning_half + '";var inning_number="' + inning_number + '";var skip="' + skip + '";var linkType="' + linkType + '";var startFrom="' + startFrom + '";var scores="' + scores + '";var scan_mode="' + scan_mode + '";' + "\n"

    // Reload function, called after options change
    body += 'var defaultDate="' + VALID_DATES[0] + '";var curDate=new Date();var utcHours=curDate.getUTCHours();if ((utcHours >= ' + todayUTCHours + ') && (utcHours < ' + YESTERDAY_UTC_HOURS + ')){defaultDate="' + VALID_DATES[1] + '"}function reload(){var newurl="/?";if (date != defaultDate){newurl+="date="+date+"&"}if (mediaType != "' + VALID_MEDIA_TYPES[0] + '"){newurl+="mediaType="+mediaType+"&"}if (mediaType=="Video"){if (resolution != "' + VALID_RESOLUTIONS[0] + '"){newurl+="resolution="+resolution+"&"}if (audio_track != "' + VALID_AUDIO_TRACKS[0] + '"){newurl+="audio_track="+encodeURIComponent(audio_track)+"&"}if (audio_url != ""){newurl+="audio_url="+encodeURIComponent(audio_url)+"&"}}if (linkType=="Stream"){if (force_vod != "' + VALID_FORCE_VOD[0] + '"){newurl+="force_vod="+force_vod+"&"}}if (inning_half != "' + VALID_INNING_HALF[0] + '"){newurl+="inning_half="+inning_half+"&"}if (inning_number != "' + VALID_INNING_NUMBER[0] + '"){newurl+="inning_number="+inning_number+"&"}if (skip != "' + VALID_SKIP[0] + '"){newurl+="skip="+skip+"&"}if (linkType != "' + VALID_LINK_TYPES[0] + '"){newurl+="linkType="+linkType+"&"}if (linkType=="Embed"){if (startFrom != "' + VALID_START_FROM[0] + '"){newurl+="startFrom="+startFrom+"&"}}if (scores != "' + VALID_SCORES[0] + '"){newurl+="scores="+scores+"&"}if (scan_mode != "' + session.data.scan_mode + '"){newurl+="scan_mode="+scan_mode+"&"}window.location=newurl.substring(0,newurl.length-1)}' + "\n"

    // Ajax function for multiview and highlights
    body += 'function makeGETRequest(url, callback){var request=new XMLHttpRequest();request.onreadystatechange=function(){if (request.readyState==4 && request.status==200){            callback(request.responseText)}};request.open("GET", url);request.send();}' + "\n"

    // Multiview functions
    body += 'function parsemultiviewresponse(responsetext){if (responsetext == "started"){setTimeout(function(){document.getElementById("startmultiview").innerHTML="Started";document.getElementById("stopmultiview").innerHTML="Stop"},15000)}else if (responsetext == "stopped"){setTimeout(function(){document.getElementById("stopmultiview").innerHTML="Stopped";document.getElementById("startmultiview").innerHTML="Start"},3000)}else{alert(responsetext)}}function addmultiview(e){for(var i=1;i<=4;i++){var valuefound = false;var oldvalue="";var newvalue=e.value;if(!e.checked){oldvalue=e.value;newvalue=""}if (document.getElementById("multiview" + i).value == oldvalue){document.getElementById("multiview" + i).value=newvalue;valuefound=true;break}}if(e.checked && !valuefound){e.checked=false}}function startmultiview(e){var count=0;var getstr="";for(var i=1;i<=4;i++){if (document.getElementById("multiview"+i).value != ""){count++;getstr+="streams="+encodeURIComponent(document.getElementById("multiview"+i).value)+"&sync="+encodeURIComponent(document.getElementById("sync"+i).value)+"&"}}if((count >= 1) && (count <= 4)){if (document.getElementById("dvr").checked){getstr+="&dvr=true"}e.innerHTML="starting...";makeGETRequest("/multiview?"+getstr, parsemultiviewresponse)}else{alert("Multiview requires between 1-4 streams to be selected")}return false}function stopmultiview(e){e.innerHTML="stopping...";makeGETRequest("/multiview", parsemultiviewresponse);return false}' + "\n"

    // Function to switch URLs to stream URLs, where necessary
    body += 'function stream_substitution(url){return url.replace(/\\/([a-zA-Z]+\.html)/,"/stream.m3u8")}' + "\n"

    // Adds touch capability to hover tooltips
    body += 'document.addEventListener("touchstart", function() {}, true);' + "\n"

		body += '</script></head><body><h1>' + appname + '</h1>' + "\n"

    body += '<p><span class="tooltip tinytext">Touch or hover over an option name for more details</span></p>' + "\n"

    todayUTCHours -= 4
    body += '<p><span class="tooltip">Date<span class="tooltiptext">"today" lasts until ' + todayUTCHours + ' AM EST. Home page will default to yesterday between ' + todayUTCHours + ' AM - ' + (YESTERDAY_UTC_HOURS - 4) + ' AM EST.</span></span>: <input type="date" id="gameDate" value="' + gameDate + '"/> '
    for (var i = 0; i < VALID_DATES.length; i++) {
      body += '<button '
      if ( ((VALID_DATES[i] == 'today') && (gameDate == session.liveDate())) || ((VALID_DATES[i] == 'yesterday') && (gameDate == session.yesterdayDate())) ) body += 'class="default" '
      body += 'onclick="date=\'' + VALID_DATES[i] + '\';reload()">' + VALID_DATES[i] + '</button> '
    }
    body += '</p>' + "\n" + '<p><span class="tinytext">Updated ' + session.getCacheUpdatedDate(gameDate) + '</span></p>' + "\n"

    body += '<p><span class="tooltip">Media Type<span class="tooltiptext">Video is TV broadcasts, Audio is English radio, and Spanish is Spanish radio (not available for all games).</span></span>: '
    for (var i = 0; i < VALID_MEDIA_TYPES.length; i++) {
      body += '<button '
      if ( mediaType == VALID_MEDIA_TYPES[i] ) body += 'class="default" '
      body += 'onclick="mediaType=\'' + VALID_MEDIA_TYPES[i] + '\';reload()">' + VALID_MEDIA_TYPES[i] + '</button> '
    }
    body += '</p>' + "\n"

    body += '<p><span class="tooltip">Link Type<span class="tooltiptext">Embed will play in your browser (with AirPlay support), Stream will give you a stream URL to open directly in media players like Kodi or VLC, Chromecast is a desktop browser-based casting tool, and Advanced will play in your desktop browser with some extra tools and debugging information.</span></span>: '
    for (var i = 0; i < VALID_LINK_TYPES.length; i++) {
      body += '<button '
      if ( linkType == VALID_LINK_TYPES[i] ) body += 'class="default" '
      body += 'onclick="linkType=\'' + VALID_LINK_TYPES[i] + '\';reload()">' + VALID_LINK_TYPES[i] + '</button> '
    }
    body += '</p>' + "\n"

    body += '<p>'
    if ( linkType == 'Embed' ) {
      body += '<span class="tooltip">Start From<span class="tooltiptext">For the embedded player only: Beginning will start playback at the beginning of the stream (may be 1 hour before game time for live games), and Live will start at the live point (if the event is live -- archive games should always start at the beginning). You can still seek anywhere.</span></span>: '
      for (var i = 0; i < VALID_START_FROM.length; i++) {
        body += '<button '
        if ( startFrom == VALID_START_FROM[i] ) body += 'class="default" '
        body += 'onclick="startFrom=\'' + VALID_START_FROM[i] + '\';reload()">' + VALID_START_FROM[i] + '</button> '
      }
      body += "\n"
    }

    if ( mediaType == 'Video' ) {
      if ( linkType == 'Embed' ) {
        body += 'or '
      }
      body += '<span class="tooltip">Inning<span class="tooltiptext">For video streams only: choose the inning to start with. If specified, seeking to an earlier point will not be possible. Default is the beginning of the stream. Inning 0 (zero) should be the broadcast start time, if specified.</span></span>: '
      body += '<select id="inning_half" onchange="inning_half=this.value;reload()">'
      for (var i = 0; i < VALID_INNING_HALF.length; i++) {
        body += '<option value="' + VALID_INNING_HALF[i] + '"'
        if ( inning_half == VALID_INNING_HALF[i] ) body += ' selected'
        body += '>' + VALID_INNING_HALF[i] + '</option> '
      }
      body += '</select>' + "\n"

      body += ' '
      body += '<select id="inning_number" onchange="inning_number=this.value;reload()">'
      for (var i = 0; i < VALID_INNING_NUMBER.length; i++) {
        body += '<option value="' + VALID_INNING_NUMBER[i] + '"'
        if ( inning_number == VALID_INNING_NUMBER[i] ) body += ' selected'
        body += '>' + VALID_INNING_NUMBER[i] + '</option> '
      }
      body += '</select>'
    }
    body += '</p>' + "\n"

    body += '<p><span class="tooltip">Scores<span class="tooltiptext">Choose whether to show scores on this web page.</span></span>: '
    for (var i = 0; i < VALID_SCORES.length; i++) {
      body += '<button '
      if ( scores == VALID_SCORES[i] ) body += 'class="default" '
      body += 'onclick="scores=\'' + VALID_SCORES[i] + '\';reload()">' + VALID_SCORES[i] + '</button> '
    }
    body += '</p>' + "\n"

    body += "<table>" + "\n"

    // Rename some parameters before display links
    var mediaFeedType = 'mediaFeedType'
    var language = 'en'
    if ( mediaType == 'Video' ) {
      mediaType = 'MLBTV'
    } else if ( mediaType == 'Spanish' ) {
      mediaType = 'Audio'
      language = 'es'
    }
    if ( mediaType == 'Audio' ) {
      mediaFeedType = 'type'
    }
    linkType = linkType.toLowerCase()
    let link = linkType + '.html'
    if ( linkType == 'stream' ) {
      link = linkType + '.m3u8'
    } else {
      force_vod = 'off'
    }
    var thislink = '/' + link

    for (var j = 0; j < cache_data.dates[0].games.length; j++) {
      let game_started = false

      let awayteam = cache_data.dates[0].games[j].teams['away'].team.abbreviation
      let hometeam = cache_data.dates[0].games[j].teams['home'].team.abbreviation

      let teams = awayteam + " @ " + hometeam
      let pitchers = ""
      let state = "<br/>"

      if ( cache_data.dates[0].games[j].status.startTimeTBD == true ) {
        state += "Time TBD"
      } else {
        let startTime = new Date(cache_data.dates[0].games[j].gameDate)
        state += startTime.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true })
      }

      var abstractGameState = cache_data.dates[0].games[j].status.abstractGameState
      var detailedState = cache_data.dates[0].games[j].status.detailedState

      if ( (scores == 'Show') && (cache_data.dates[0].games[j].gameUtils.isLive || cache_data.dates[0].games[j].gameUtils.isFinal) && !cache_data.dates[0].games[j].gameUtils.isCancelled && !cache_data.dates[0].games[j].gameUtils.isPostponed ) {
        let awayscore = cache_data.dates[0].games[j].teams['away'].score
        let homescore = cache_data.dates[0].games[j].teams['home'].score
        teams = awayteam + " " + awayscore + " @ " + hometeam + " " + homescore
        if ( cache_data.dates[0].games[j].gameUtils.isLive && !cache_data.dates[0].games[j].gameUtils.isFinal ) {
          state = "<br/>" + cache_data.dates[0].games[j].linescore.inningHalf.substr(0,1) + cache_data.dates[0].games[j].linescore.currentInning
        } else if ( cache_data.dates[0].games[j].gameUtils.isFinal ) {
          state = "<br/>" + detailedState
        }
        if ( cache_data.dates[0].games[j].flags.perfectGame == 'true'  ) {
          state = "<br/>Perfect Game"
        } else if ( cache_data.dates[0].games[j].flags.noHitter == 'true'  ) {
          state = "<br/>No-Hitter"
        }
      } else if ( cache_data.dates[0].games[j].gameUtils.isCancelled || cache_data.dates[0].games[j].gameUtils.isPostponed || cache_data.dates[0].games[j].gameUtils.isSuspended ) {
        state = "<br/>" + detailedState
      } else if ( cache_data.dates[0].games[j].gameUtils.isDelayed ) {
        state += "<br/>" + detailedState
      }

      if ( cache_data.dates[0].games[j].doubleHeader != 'N'  ) {
        state += "<br/>Game " + cache_data.dates[0].games[j].gameNumber
      }
      if ( cache_data.dates[0].games[j].description ) {
        state += "<br/>" + cache_data.dates[0].games[j].description
      }

      if ( (cache_data.dates[0].games[j].teams['away'].probablePitcher && cache_data.dates[0].games[j].teams['away'].probablePitcher.lastName) || (cache_data.dates[0].games[j].teams['home'].probablePitcher && cache_data.dates[0].games[j].teams['home'].probablePitcher.lastName) ) {
        pitchers = "<br/>"
        if ( cache_data.dates[0].games[j].teams['away'].probablePitcher && cache_data.dates[0].games[j].teams['away'].probablePitcher.lastName ) {
          pitchers += '<a href="https://mlb.com/player/' + cache_data.dates[0].games[j].teams['away'].probablePitcher.nameSlug + '" target="_blank">' + cache_data.dates[0].games[j].teams['away'].probablePitcher.lastName + '</a>'
        } else {
          pitchers += 'TBD'
        }
        pitchers += ' vs '
        if ( cache_data.dates[0].games[j].teams['home'].probablePitcher && cache_data.dates[0].games[j].teams['home'].probablePitcher.lastName ) {
          pitchers += '<a href="https://mlb.com/player/' + cache_data.dates[0].games[j].teams['home'].probablePitcher.nameSlug + '" target="_blank">' +cache_data.dates[0].games[j].teams['home'].probablePitcher.lastName + '</a>'
        } else {
          pitchers += 'TBD'
        }
      }

      body += "<tr><td>" + teams + pitchers + state + "</td>"

      if ( ((typeof cache_data.dates[0].games[j].content.media) == 'undefined') || ((typeof cache_data.dates[0].games[j].content.media.epg) == 'undefined') ) {
        body += "<td></td>"
      } else {
        body += "<td>"
        for (var k = 0; k < cache_data.dates[0].games[j].content.media.epg.length; k++) {
          let epgTitle = cache_data.dates[0].games[j].content.media.epg[k].title
          if ( epgTitle == mediaType ) {
            for (var x = 0; x < cache_data.dates[0].games[j].content.media.epg[k].items.length; x++) {
              if ( ((typeof cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType) == 'undefined') || (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType.indexOf('IN_MARKET_') == -1) ) {
                if ( ((typeof cache_data.dates[0].games[j].content.media.epg[k].items[x].language) == 'undefined') || (cache_data.dates[0].games[j].content.media.epg[k].items[x].language == language) ) {
                  let teamabbr
                  if ( ((typeof cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType) != 'undefined') && (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType == 'NATIONAL') ) {
                    teamabbr = 'NATIONAL'
                  } else {
                    teamabbr = hometeam
                    if ( cache_data.dates[0].games[j].content.media.epg[k].items[x][mediaFeedType] == 'AWAY' ) {
                      teamabbr = awayteam
                    }
                  }
                  let station = cache_data.dates[0].games[j].content.media.epg[k].items[x].callLetters
                  if ( (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON') || (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ARCHIVE') || cache_data.dates[0].games[j].gameUtils.isFinal ) {
                    game_started = true
                    let mediaId = cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaId
                    if ( (mediaType == 'MLBTV') && session.data.media && session.data.media[mediaId] && session.data.media[mediaId].blackout && session.data.media[mediaId].blackoutExpiry && (Date.now() < session.data.media[mediaId].blackoutExpiry) ) {
                      body += teamabbr + ': <s>' + station + '</s>'
                    } else {
                      let querystring
                      querystring = '?mediaId=' + mediaId
                      var multiviewquerystring = querystring + '&resolution=' + DEFAULT_MULTIVIEW_RESOLUTION + '&audio_track=' + DEFAULT_MULTIVIEW_AUDIO_TRACK
                      if ( linkType == 'embed' ) {
                        if ( startFrom != 'Beginning' ) querystring += '&startFrom=' + startFrom
                      }
                      if ( mediaType == 'MLBTV' ) {
                        if ( inning_half != VALID_INNING_HALF[0] ) querystring += '&inning_half=' + inning_half
                        if ( inning_number != '' ) querystring += '&inning_number=' + inning_number
                        if ( skip != 'off' ) querystring += '&skip=' + skip
                        if ( (inning_half != VALID_INNING_HALF[0]) || (inning_number != VALID_INNING_NUMBER[0]) || (skip != VALID_SKIP[0]) ) {
                          let contentId = cache_data.dates[0].games[j].content.media.epg[k].items[x].contentId
                          querystring += '&contentId=' + contentId
                        }
                        if ( resolution != VALID_RESOLUTIONS[0] ) querystring += '&resolution=' + resolution
                        if ( audio_track != VALID_AUDIO_TRACKS[0] ) querystring += '&audio_track=' + encodeURIComponent(audio_track)
                        if ( audio_url != '' ) querystring += '&audio_url=' + encodeURIComponent(audio_url)
                      }
                      if ( linkType == 'stream' ) {
                        if ( cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON' ) {
                          if ( force_vod != VALID_FORCE_VOD[0] ) querystring += '&force_vod=' + force_vod
                        }
                      }
                      body += teamabbr + ': <a href="' + thislink + querystring + '">' + station + '</a>'
                      if ( mediaType == 'MLBTV' ) {
                        body += '<input type="checkbox" value="' + server + '/stream.m3u8' + multiviewquerystring + '" onclick="addmultiview(this)">'
                      }
                      body += ', '
                    }
                  } else {
                    body += teamabbr + ': ' + station + ', '
                  }
                }
              }
            }
            break
          }
        }
        if ( body.substr(-2) == ', ' ) {
          body = body.slice(0, -2)
        }
        if ( (mediaType == 'MLBTV') && (game_started) ) {
          body += '<br/><a href="javascript:showhighlights(\'' + cache_data.dates[0].games[j].gamePk + '\',\'' + gameDate + '\')">Highlights</a>'
        }
        if ( body.substr(-2) == ', ' ) {
          body = body.slice(0, -2)
        }
        body += "</td>"
        body += "</tr>" + "\n"
      }
    }
    body += "</table>" + "\n"

    // Rename parameter back before displaying further links
    if ( mediaType == 'MLBTV' ) {
      mediaType = 'Video'
    }

    if ( mediaType == 'Video' ) {
        body += '<p><span class="tooltip">Video<span class="tooltiptext">For video streams only: you can manually specifiy a video track (resolution) to use. Adaptive will let your client choose. 720p60 is the best quality. 540p is default for multiview (see below).<br/><br/>None will allow to remove the video tracks, if you just want to listen to the audio while using the "start at inning" or "skip breaks" options enabled.</span></span>: '
        for (var i = 0; i < VALID_RESOLUTIONS.length; i++) {
          body += '<button '
          if ( resolution == VALID_RESOLUTIONS[i] ) body += 'class="default" '
          body += 'onclick="resolution=\'' + VALID_RESOLUTIONS[i] + '\';reload()">' + VALID_RESOLUTIONS[i]
          if ( VALID_BANDWIDTHS[i] != '' ) {
            body += '<br/><span class="tinytext">' + VALID_BANDWIDTHS[i] + '</span>'
          }
          body += '</button> '
        }
        body += '</p>' + "\n"

        body += '<p><span class="tooltip">Audio<span class="tooltiptext">For video streams only: you can manually specifiy which audio track to include. Some media players can accept them all and let you choose. English is the TV broadcast audio, and the default for multiview (see below).<br/><br/>If you select "none" for video above, picking an audio track here will make it an audio-only feed that supports the inning start and skip breaks options.</span></span>: '
        for (var i = 0; i < VALID_AUDIO_TRACKS.length; i++) {
          body += '<button '
          if ( audio_track == VALID_AUDIO_TRACKS[i] ) body += 'class="default" '
          body += 'onclick="audio_track=\'' + VALID_AUDIO_TRACKS[i] + '\';reload()">' + VALID_AUDIO_TRACKS[i] + '</button> '
        }
        body += '<br/><span class="tooltip">or enter a separate audio stream URL<span class="tooltiptext">For video streams only: you can also include a separate audio stream URL as an alternate audio track. This is useful if you want to pair the road radio feed with a national TV broadcast (which only includes home radio feeds by default).<br/><br/>After entering the audio stream URL, click the Update button to include it in the video links above; click the Reset button when done with this option.</span></span>: <span class="tinytext">(copy one from the <button onclick="mediaType=\'Audio\';reload()">Audio</button> page</a>)</span><br/><textarea id="audio_url" rows=2 cols=60 oninput="this.value=stream_substitution(this.value)">' + audio_url + '</textarea><br/><button onclick="audio_url=document.getElementById(\'audio_url\').value;reload()">Update Audio URL</button> <button onclick="audio_url=\'\';reload()">Reset Audio URL</button><br/>'
        body += '</p>' + "\n"

        body += '<p><span class="tooltip">Skip<span class="tooltiptext">For video streams only (use the video "none" option above to apply it to audio streams): you can remove inning breaks or non-decision pitches/plays from the stream (the latter is useful to make your own "condensed games"). Can take a few seconds to generate.<br/><br/>NOTE: timings are only generated when the stream is loaded -- so for live games, it will only skip up to the current time.</span></span>: '
        for (var i = 0; i < VALID_SKIP.length; i++) {
          body += '<button '
          if ( skip == VALID_SKIP[i] ) body += 'class="default" '
          body += 'onclick="skip=\'' + VALID_SKIP[i] + '\';reload()">' + VALID_SKIP[i] + '</button> '
        }
        body += '</p>' + "\n"

        body += '<table><tr><td><table><tr><td>1</td><td>2</tr><tr><td>3</td><td>4</td></tr></table><td><span class="tooltip">Multiview + Audio Sync<span class="tooltiptext">For video streams only: create a new live stream combining 1-4 separate video streams in the layout shown at left. Check the boxes next to feeds above to add/remove them, then click "Start" when ready, and "Stop" when done. May take up to 15 seconds before it is ready to play.<br/><br/>This will use your server CPU for encoding. No video scaling is performed: defaults to 540p video for each stream, which can combine to make one 1080p stream.<br/><br/>Audio defaults to English (TV) audio. If you specify a radio audio track instead, you can use the box after each URL below to adjust the sync in seconds (use positive values if audio is early, negative if audio is late.) TIP: You can enter just 1 stream here to take advantage of the audio sync feature -- the video will not be re-encoded and will be presented at full resolution.<br/><br/>You can also manually enter streams from other sources like <a href="https://www.npmjs.com/package/milbserver" target="_blank">milbserver</a> in the boxes below.<br/><br/>WARNING: if mlbserver dies or gets restarted while multiview is active, the ffmpeg encoding process will be orphaned and must be killed manually.</span></span>: <a id="startmultiview" href="" onclick="startmultiview(this);return false">Start'
        if ( ffmpeg_status ) body += 'ed'
        body += '</a> | <a id="stopmultiview" href="" onclick="stopmultiview(this);return false">Stop'
        if ( !ffmpeg_status ) body += 'ped'
        body += '</a><br/>' + "\n"
        body += '<span class="tinytext">(check boxes next to games to add, then click "Start";<br/>must click "Stop" link above when done, or manually kill ffmpeg)</span></td></tr><tr><td colspan="2">' + "\n"
        body += '<input type="checkbox" id="dvr"/> DVR: allow pausing/seeking multiview <span class="tinytext">(uses more disk space)</span><br/>'
        for (var i=1; i<=4; i++) {
          body += i + ': <textarea id="multiview' + i + '" rows=2 cols=60 oninput="this.value=stream_substitution(this.value)"></textarea>'
          body += '<input type="number" id="sync' + i + '" value="0.0" step=".1" style="vertical-align:top;font-size:.8em;width:3em"/>'
          body += '<br/>' + "\n"
        }
        body += '<br/>Watch: <a href="/embed.html?src=' + encodeURIComponent(multiview_url) + '">Embed</a> | <a href="' + multiview_url + '">Stream</a> | <a href="/chromecast.html?src=' + encodeURIComponent(multiview_url) + '">Chromecast</a> | <a href="/advanced.html?src=' + encodeURIComponent(multiview_url) + '">Advanced</a><br/><span class="tinytext">Kodi STRM file: <a href="/multiview.strm">Matrix/19</a> | <a href="/multiview.strm?version=18">Leia/18</a></span>'
        body += '</td></tr></table>' + "\n"
    }

    if ( (linkType == 'stream') && (gameDate == session.liveDate()) ) {
      body += '<p><span class="tooltip">Force VOD<span class="tooltiptext">For streams only: if your client does not support seeking in mlbserver live streams, turning this on will make the stream look like a VOD stream instead, allowing the client to start at the beginning and allowing the user to seek within it. You will need to reload the stream to watch/view past the current time, though.</span></span>: '
      for (var i = 0; i < VALID_FORCE_VOD.length; i++) {
        body += '<button '
        if ( force_vod == VALID_FORCE_VOD[i] ) body += 'class="default" '
        body += 'onclick="force_vod=\'' + VALID_FORCE_VOD[i] + '\';reload()">' + VALID_FORCE_VOD[i] + '</button> '
      }
      body += '<span class="tinytext">(if client does not support seeking in live streams)</span></p>' + "\n"
    }

    let media_center_link = '/live-stream-games/' + gameDate.replace(/-/g,'/') + '?linkType=' + linkType
    body += '<p><span class="tooltip">Media Center View<span class="tooltiptext">Allows you to use the MLB Media Center page format for nagivation. However, only the "Link Type" option is supported.</span></span>: <a href="' + media_center_link + '" target="_blank">Link</a></p>' + "\n"

    body += '<table><tr><td>' + "\n"

    body += '<p><span class="tooltip">Live Channel Playlist and XMLTV Guide<span class="tooltiptext">Allows you to generate a M3U playlist of channels, and an XML file of guide listings for those channels, to import into TV/DVR/PVR software like Tvheadend or Jellyfin.<br/><br/>NOTE: May be helpful to specify a resolution above.</span></span>:</p>' + "\n"

    body += '<p><span class="tooltip">Scan Mode<span class="tooltiptext">During setup, some TV/DVR/PVR software will attempt to load all stream URLs. Turning Scan Mode ON will return a sample stream for all stream requests, thus satisfying that software without overloading mlbserver or excluding streams which aren\'t currently live. Once the channels are set up, turning Scan Mode OFF will restore normal stream behavior.<br/><br/>WARNING: Be sure your TV/DVR/PVR software doesn\'t periodically scan all channels automatically or you might overload mlbserver.</span></span>: '
    let options = ['off', 'on']
    for (var i = 0; i < options.length; i++) {
      body += '<button '
      if ( scan_mode == options[i] ) body += 'class="default" '
      body += 'onclick="scan_mode=\'' + options[i] + '\';reload()">' + options[i] + '</button> '
    }
    body += ' <span class="tinytext">(ON plays sample for all stream requests)</span></p>' + "\n"

    body += '<p>All: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '">guide.xml</a></p>' + "\n"

    body += '<p><span class="tooltip">By team<span class="tooltiptext">Including a team will include that team\'s broadcasts, not their opponent\'s broadcasts or national TV broadcasts.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&includeTeams=ari">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeTeams=ari">guide.xml</a></p>' + "\n"

    body += '<p><span class="tooltip">Exclude a team + national<span class="tooltiptext">This is useful for excluding games you may be blacked out from. Excluding a team will exclude every game involving that team. National refers to USA national TV broadcasts.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&excludeTeams=ari,national">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&excludeTeams=ari,national">guide.xml</a></p>' + "\n"

    body += '</td></tr></table>' + "\n"

    body += '<p><span class="tooltip">Sample video<span class="tooltiptext">A sample stream. Useful for testing and troubleshooting.</span></span>: <a href="/embed.html">Embed</a> | <a href="/stream.m3u8">Stream</a> | <a href="/chromecast.html">Chromecast</a> | <a href="/advanced.html">Advanced</a></p>' + "\n"

    body += '<p><span class="tooltip">Bookmarklets for MLB.com<span class="tooltiptext">If you watch at MLB.com, drag these bookmarklets to your bookmarks toolbar and use them to hide parts of the interface.</span></span>: <a href="javascript:(function(){let x=document.querySelector(\'#mlbtv-stats-panel\');if(x.style.display==\'none\'){x.style.display=\'initial\';}else{x.style.display=\'none\';}})();">Boxscore</a> | <a href="javascript:(function(){let x=document.querySelector(\'.mlbtv-header-container\');if(x.style.display==\'none\'){let y=document.querySelector(\'.mlbtv-players-container\');y.style.display=\'none\';x.style.display=\'initial\';setTimeout(function(){y.style.display=\'initial\';},15);}else{x.style.display=\'none\';}})();">Scoreboard</a> | <a href="javascript:(function(){let x=document.querySelector(\'.mlbtv-container--footer\');if(x.style.display==\'none\'){let y=document.querySelector(\'.mlbtv-players-container\');y.style.display=\'none\';x.style.display=\'initial\';setTimeout(function(){y.style.display=\'initial\';},15);}else{x.style.display=\'none\';}})();">Linescore</a> | <a href="javascript:(function(){let x=document.querySelector(\'#mlbtv-stats-panel\');if(x.style.display==\'none\'){x.style.display=\'initial\';}else{x.style.display=\'none\';}x=document.querySelector(\'.mlbtv-header-container\');if(x.style.display==\'none\'){x.style.display=\'initial\';}else{x.style.display=\'none\';}x=document.querySelector(\'.mlbtv-container--footer\');if(x.style.display==\'none\'){let y=document.querySelector(\'.mlbtv-players-container\');y.style.display=\'none\';x.style.display=\'initial\';setTimeout(function(){y.style.display=\'initial\';},15);}else{x.style.display=\'none\';}})();">All</a></p>' + "\n"

    // Datepicker functions
    body += '<script>var datePicker=document.getElementById("gameDate");function changeDate(e){date=datePicker.value;reload()}function removeDate(e){datePicker.removeEventListener("change",changeDate,false);datePicker.addEventListener("blur",changeDate,false);if(e.keyCode===13){date=datePicker.value;reload()}}datePicker.addEventListener("change",changeDate,false);datePicker.addEventListener("keypress",removeDate,false)</script>' + "\n"

    // Highlights modal defintion
    body += '<div id="myModal" class="modal"><div class="modal-content"><span class="close">&times;</span><div id="highlights"></div></div></div>'

    // Highlights modal functions
    body += '<script type="text/javascript">var modal = document.getElementById("myModal");var highlightsModal = document.getElementById("highlights");var span = document.getElementsByClassName("close")[0];function parsehighlightsresponse(responsetext) { try { var highlightsData = JSON.parse(responsetext);var modaltext = "<ul>"; if (highlightsData.highlights && highlightsData.highlights.highlights && highlightsData.highlights.highlights.items && highlightsData.highlights.highlights.items[0]) { for (var i = 0; i < highlightsData.highlights.highlights.items.length; i++) { modaltext += "<li><a href=\'' + link + '?src=" + encodeURIComponent(highlightsData.highlights.highlights.items[i].playbacks[3].url) + "&resolution=" + resolution + "\'>" + highlightsData.highlights.highlights.items[i].headline + "</a><span class=\'tinytext\'> (<a href=\'" + highlightsData.highlights.highlights.items[i].playbacks[0].url + "\'>MP4</a>)</span></li>" } } else { modaltext += "No highlights available for this game.";}modaltext += "</ul>";highlightsModal.innerHTML = modaltext;modal.style.display = "block"} catch (e) { alert("Error processing highlights: " + e.message)}} function showhighlights(gamePk, gameDate) { makeGETRequest("/highlights?gamePk=" + gamePk + "&gameDate=" + gameDate, parsehighlightsresponse);return false} span.onclick = function() {modal.style.display = "none";}' + "\n"
    body += 'window.onclick = function(event) { if (event.target == modal) { modal.style.display = "none"; } }</script>' + "\n"

    body += "</body></html>"

    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(body)
  } catch (e) {
    session.log('home request error : ' + e.message)
    res.end('')
  }
})

// Listen for OPTIONS requests and respond with CORS headers
app.options('*', function(req, res) {
  session.debuglog('OPTIONS request : ' + req.url)
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

// Listen for live-stream-games (schedule) page requests, return the page after local url substitution
app.get('/live-stream-games*', async function(req, res) {
  session.debuglog('schedule request : ' + req.url)

  // check for a linkType parameter in the url
  let linkType = 'embed'
  if ( req.query.linkType ) {
    linkType = req.query.linkType
    session.setLinkType(linkType)
  }

  // use the link type to determine the local url to use
  var local_url = '/embed.html' // default to embedded player
  if ( linkType == 'stream' ) { // direct stream
    local_url = '/stream.m3u8'
  } else { // other
    local_url = '/' + linkType + '.html'
  }

  // remove our linkType parameter, if specified, from the url we will fetch remotely
  var remote_url = url.parse(req.url).pathname

  let reqObj = {
    url: 'https://www.mlb.com' + remote_url,
    headers: {
      'User-Agent': session.USER_AGENT,
      'Origin': 'https://www.mlb.com',
      'Accept-Encoding': 'gzip, deflate, br'
    },
    gzip: true
  }

  var body = await session.httpGet(reqObj)

  // a regex substitution to change existing links to local urls
  body = body.replace(/https:\/\/www.mlb.com\/tv\/g\d+\/[v]([a-zA-Z0-9-]+)/g,local_url+"?contentId=$1")

  // hide popup to accept cookies
  body = body.replace(/www.googletagmanager.com/g,'0.0.0.0')

  res.end(body)
})

// Listen for embed request, respond with embedded hls.js player
app.get('/embed.html', function(req, res) {
  session.log('embed.html request : ' + req.url)

  delete req.headers.host

  let startFrom = 'Beginning'
  if ( req.query.startFrom ) {
    startFrom = req.query.startFrom
  }

  let video_url = '/stream.m3u8'
  if ( req.query.src && (req.query.src == multiview_url) ) {
    video_url = req.query.src
    startFrom = 'Live'
  } else {
    let urlArray = req.url.split('?')
    if ( (urlArray.length == 2) ) {
      video_url += '?' + urlArray[1]
    }
  }
  session.debuglog('embed src : ' + video_url)

  // Adapted from https://hls-js.netlify.app/demo/basic-usage.html
  var body = '<html><head><meta charset="UTF-8"><meta http-equiv="Content-type" content="text/html;charset=UTF-8"><title>' + appname + ' player</title><link rel="icon" href="favicon.svg"><style type="text/css">input[type=text],input[type=button]{-webkit-appearance:none;-webkit-border-radius:0}body{background-color:black;color:lightgrey;font-family:Arial,Helvetica,sans-serif}video{width:100% !important;height:auto !important;max-width:1280px}input[type=number]::-webkit-inner-spin-button{opacity:1}button{color:lightgray;background-color:black}button.default{color:black;background-color:lightgray}</style><script>function goBack(){var prevPage=window.location.href;window.history.go(-1);setTimeout(function(){if(window.location.href==prevPage){window.location.href="/"}}, 500)}function toggleAudio(x){var elements=document.getElementsByClassName("audioButton");for(var i=0;i<elements.length;i++){elements[i].className="audioButton"}document.getElementById("audioButton"+x).className+=" default";hls.audioTrack=x}function changeTime(x){video.currentTime+=x}function changeRate(x){let newRate=Math.round((Number(document.getElementById("playback_rate").value)+x)*10)/10;if((newRate<=document.getElementById("playback_rate").max) && (newRate>=document.getElementById("playback_rate").min)){document.getElementById("playback_rate").value=newRate.toFixed(1);video.defaultPlaybackRate=video.playbackRate=document.getElementById("playback_rate").value}}function myKeyPress(e){if(e.key=="ArrowRight"){changeTime(10)}else if(e.key=="ArrowLeft"){changeTime(-10)}else if(e.key=="ArrowUp"){changeRate(0.1)}else if(e.key=="ArrowDown"){changeRate(-0.1)}}</script></head><body onkeydown="myKeyPress(event)"><script src="https://hls-js.netlify.app/dist/hls.js"></script><video id="video" controls></video><script>var video=document.getElementById("video");if(Hls.isSupported()){var hls=new Hls('

  if ( startFrom != 'Live' ) {
    body += '{startPosition:0,liveSyncDuration:32400,liveMaxLatencyDuration:32410}'
  }

  body += ');hls.loadSource("' + video_url + '");hls.attachMedia(video);hls.on(Hls.Events.MEDIA_ATTACHED,function(){video.muted=true;video.play()});hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function(){var audioSpan=document.getElementById("audioSpan");var audioButtons="";for(var i=0;i<hls.audioTracks.length;i++){audioButtons+=\'<button id="audioButton\'+i+\'" class="audioButton\';if(i==0){audioButtons+=\' default\'}audioButtons+=\'" onclick="toggleAudio(\'+i+\')">\'+hls.audioTracks[i]["name"]+"</button> "}audioSpan.innerHTML=audioButtons})}else if(video.canPlayType("application/vnd.apple.mpegurl")){video.src="' + video_url + '";video.addEventListener("canplay",function(){video.play()})}</script><p>Skip: <button onclick="changeTime(-10)">- 10 s</button> <button onclick="changeTime(10)">+ 10 s</button> <button onclick="changeTime(30)">+ 30 s</button> <button onclick="changeTime(90)">+ 90 s</button>  <button onclick="changeTime(120)">+ 120 s</button> '

  body += '<button onclick="changeTime(video.duration-10)">Latest</button> '

  body += '<button id="airplay">AirPlay</button></p><p>Playback rate: <input type="number" value=1.0 min=0.1 max=16.0 step=0.1 id="playback_rate" size="8" style="width: 4em" onchange="video.defaultPlaybackRate=video.playbackRate=this.value"></p><p>Audio: <button onclick="video.muted=!video.muted">Toggle Mute</button> <span id="audioSpan"></span></p><p><button onclick="goBack()">Back</button></p><script>var airPlay=document.getElementById("airplay");if(window.WebKitPlaybackTargetAvailabilityEvent){video.addEventListener("webkitplaybacktargetavailabilitychanged",function(event){switch(event.availability){case "available":airPlay.style.display="inline";break;default:airPlay.style.display="none"}airPlay.addEventListener("click",function(){video.webkitShowPlaybackTargetPicker()})})}else{airPlay.style.display="none"}</script></body></html>'
  res.end(body)
})

// Listen for advanced embed request, redirect to online demo hls.js player
app.get('/advanced.html', function(req, res) {
  session.log('advanced embed request : ' + req.url)

  delete req.headers.host

  let video_url = '/stream.m3u8'
  if ( req.query.src && (req.query.src == multiview_url) ) {
    video_url = multiview_url
  } else {
    let urlArray = req.url.split('?')
    if ( (urlArray.length == 2) ) {
      video_url += '?' + urlArray[1]
    }
    video_url = server + video_url
  }
  session.debuglog('advanced embed src : ' + video_url)

  res.redirect('http://hls-js.netlify.app/demo/?src=' + encodeURIComponent(video_url))
})

// Listen for Chromecast request, redirect to chromecast.link player
app.get('/chromecast.html', function(req, res) {
  session.log('chromecast request : ' + req.url)

  delete req.headers.host

  let video_url = '/stream.m3u8'
  if ( req.query.src && (req.query.src == multiview_url) ) {
    video_url = multiview_url
  } else {
    let urlArray = req.url.split('?')
    if ( (urlArray.length == 2) ) {
      video_url += '?' + urlArray[1]
    }
    video_url = server + video_url
  }
  session.debuglog('chromecast src : ' + video_url)

  // Include "server" with URL so it points to IP address (as Chromecast cannot resolve local domain names)
  res.redirect('https://chromecast.link#title=' + appname + '&content=' + encodeURIComponent(video_url))
})

// Listen for live channels.m3u request
app.get('/channels.m3u', async function(req, res) {
  session.log('channels.m3u request : ' + req.url)

  delete req.headers.host

  let mediaType = 'Video'
  if ( req.query.mediaType ) {
    mediaType = req.query.mediaType
  }

  let includeTeams = []
  if ( req.query.includeTeams ) {
    includeTeams = req.query.includeTeams.toUpperCase().split(',')
  }
  let excludeTeams = []
  if ( req.query.excludeTeams ) {
    excludeTeams = req.query.excludeTeams.toUpperCase().split(',')
  }

  let resolution = 'best'
  if ( req.query.resolution ) {
    resolution = req.query.resolution
  }

  let pipe = 'false'
  if ( req.query.pipe ) {
    pipe = req.query.pipe
  }

  let startingChannelNumber = 1
  if ( req.query.startingChannelNumber ) {
    startingChannelNumber = req.query.startingChannelNumber
  }

  var body = await session.getChannels(mediaType, includeTeams, excludeTeams, server, resolution, pipe, startingChannelNumber)

  res.writeHead(200, {'Content-Type': 'audio/x-mpegurl'})
  res.end(body)
})

// Listen for guide.xml request
app.get('/guide.xml', async function(req, res) {
  session.log('guide.xml request : ' + req.url)

  delete req.headers.host

  let mediaType = 'Video'
  if ( req.query.mediaType ) {
    mediaType = req.query.mediaType
  }

  let includeTeams = []
  if ( req.query.includeTeams ) {
    includeTeams = req.query.includeTeams.toUpperCase().split(',')
  }
  let excludeTeams = []
  if ( req.query.excludeTeams ) {
    excludeTeams = req.query.excludeTeams.toUpperCase().split(',')
  }

  var body = await session.getGuide(mediaType, includeTeams, excludeTeams, server)

  res.end(body)
})

// Listen for image requests
app.get('/image.svg', async function(req, res) {
  session.debuglog('image request : ' + req.url)

  delete req.headers.host

  let teamId = 'MLB'
  if ( req.query.teamId ) {
    teamId = req.query.teamId
  }

  var body = await session.getImage(teamId)

  res.writeHead(200, {'Content-Type': 'image/svg+xml'})
  res.end(body)
})

// Listen for favicon requests
app.get('/favicon.svg', async function(req, res) {
  session.debuglog('favicon request : ' + req.url)

  delete req.headers.host

  var body = await session.getImage('MLB')

  res.writeHead(200, {'Content-Type': 'image/svg+xml'})
  res.end(body)
})

// Listen for highlights requests
app.get('/highlights', async function(req, res) {
  try {
    session.log('highlights request : ' + req.url)

    delete req.headers.host

    let highlightsData = ''
    if ( req.query.gamePk && req.query.gameDate ) {
      highlightsData = await session.getHighlightsData(req.query.gamePk, req.query.gameDate)
    }
    res.end(JSON.stringify(highlightsData))
  } catch (e) {
    session.log('highlights request error : ' + e.message)
    res.end('')
  }
})

// Listen for multiview requests
app.get('/multiview', async function(req, res) {
  try {
    session.log('multiview request : ' + req.url)

    delete req.headers.host

    try {
      ffmpeg_command.kill()
      session.clear_multiview_files()
    } catch (e) {
      //session.debuglog('error killing multiview command:' + e.message)
    }

    if ( req.query.streams ) {
      let sync = []
      if ( req.query.sync ) {
        sync = req.query.sync
      }
      let dvr = false
      if ( req.query.dvr ) {
        dvr = req.query.dvr
      }
      // Wait to restart it
      setTimeout(function() {
        res.end(start_multiview_stream(req.query.streams, sync, dvr))
      }, 5000)
    } else {
      res.end('stopped')
    }
  } catch (e) {
    session.log('multiview request error : ' + e.message)
    res.end('multiview request error, check log')
  }
})

function start_multiview_stream(streams, sync, dvr) {
  try {
    ffmpeg_command = ffmpeg({ timeout: 432000 })

    // If it's not already an array (only 1 parameter was passed in URL), convert it
    if ( !Array.isArray(streams) ) streams = [streams]
    if ( !Array.isArray(sync) ) sync = [sync]

    // Max 4 streams
    var stream_count = Math.min(streams.length, 4)

    var complexFilter = []
    var xstack_inputs = []
    var xstack_layout = '0_0|w0_0'
    var map_audio = ''

    let video_output = '0'
    for (var i=0; i<stream_count; i++) {
      let url = streams[i]

      // Stream URL for testing
      //url = SAMPLE_STREAM_URL

      // Production
      ffmpeg_command.input(url)
      .native()
      .addInputOption('-thread_queue_size', '4096')

      // Only apply video filters if more than 1 stream
      if ( stream_count > 1 ) {
        complexFilter.push({
          filter: 'setpts=PTS-STARTPTS',
          inputs: i+':v',
          outputs: 'v'+i
        })
        xstack_inputs.push('v'+i)
      }
    }

    // Only apply video filters if more than 1 stream
    if ( stream_count > 1 ) {
      video_output = 'out'
      if ( stream_count > 2 ) xstack_layout += '|0_h0'
      if ( stream_count > 3 ) xstack_layout += '|w0_h0'
      complexFilter.push({
        filter: 'xstack',
        options: { inputs:stream_count, layout: xstack_layout, fill:'black' },
        inputs: xstack_inputs,
        outputs: video_output
      })
      video_output = '[' + video_output + ']'
    }

    // Audio filters
    for (var i=0; i<stream_count; i++) {
      let audio_input = i + ':a:0'
      let filter = ''
      if ( sync[i] ) {
        if ( sync[i] > 0 ) {
          session.log('delaying audio for stream ' + (i+1) + ' by ' + sync[i] + ' seconds')
          filter = 'adelay=' + (sync[i] * 1000) + ','
        } else if ( sync[i] < 0 ) {
          session.log('trimming audio for stream ' + (i+1) + ' by ' + sync[i] + ' seconds')
          filter = 'atrim=start=' + (sync[i] * -1) + 's,'
        }
      }
      // Resampling adds silence to preserve timestamps, and padding makes its length match the video track
      complexFilter.push({
        filter: 'aresample=async=1:first_pts=0,' + filter + 'asetpts=PTS-STARTPTS,apad',
        inputs: audio_input,
        outputs: 'out' + i
      })
    }

    ffmpeg_command.complexFilter(complexFilter)
    .addOutputOption('-map', video_output + ':v')

    var var_stream_map = 'v:0,agroup:aac'
    for (var i=0; i<stream_count; i++) {
      ffmpeg_command.addOutputOption('-map', '[out' + i + ']')
      var_stream_map += ' a:' + i + ',agroup:aac,language:ENG'
      if ( i == 0 ) var_stream_map += ',default:yes'
    }

    // Default to keep only 12 segments (1 minute) on disk, unless dvr is specified
    var hls_list_size = 12
    var delete_segments = 'delete_segments+'
    if ( dvr ) {
      hls_list_size = 0
      delete_segments = ''
    }

    if ( stream_count > 1 ) {
      // Only re-encode video if there is more than 1 stream
      let bandwidth = 1040 * stream_count
      ffmpeg_command.addOutputOption('-c:v', ffmpegEncoder)
      .addOutputOption('-pix_fmt:v', 'yuv420p')
      .addOutputOption('-preset:v', 'superfast')
      .addOutputOption('-r:v', '30')
      .addOutputOption('-g:v', '150')
      .addOutputOption('-keyint_min:v', '150')
      .addOutputOption('-b:v', bandwidth.toString() + 'k')
    } else {
      // If only 1 stream, just copy the video without re-encoding
      ffmpeg_command.addOutputOption('-c:v', 'copy')
    }
    ffmpeg_command.addOutputOption('-c:a', 'aac')
    .addOutputOption('-strict', 'experimental')
    .addOutputOption('-sn')
    .addOutputOption('-shortest')
    .addOutputOption('-f', 'hls')
    .addOutputOption('-hls_time', '5')
    .addOutputOption('-hls_list_size', hls_list_size)
    .addOutputOption('-hls_allow_cache', '0')
    .addOutputOption('-hls_flags', delete_segments + 'independent_segments+discont_start+program_date_time')

    if ( dvr ) {
      ffmpeg_command.addOutputOption('-hls_playlist_type', 'event')
    }

    ffmpeg_command.addOutputOption('-start_number', '1')
    .addOutputOption('-hls_segment_filename', session.get_multiview_directory() + '/stream_%v_%d.ts')
    .addOutputOption('-var_stream_map', var_stream_map)
    .addOutputOption('-master_pl_name', multiview_stream_name)
    .addOutputOption('-y')
    .output(session.get_multiview_directory() + '/stream-%v.m3u8')
    .on('start', function() {
      session.log('multiview stream started')
      ffmpeg_status = true
    })
    .on('error', function(err) {
      session.log('multiview stream stopped: ' + err.message)
      ffmpeg_status = false
    })
    .on('end', function() {
      session.log('multiview stream ended')
      ffmpeg_status = false
    })

    if ( argv.ffmpeg_logging ) {
      session.log('ffmpeg output logging enabled')
      ffmpeg_command.on('stderr', function(stderrLine) {
        session.log(stderrLine);
      })
    }

    ffmpeg_command.run()

    session.log('multiview stream command started')

    return 'started'
  } catch (e) {
    session.log('multiview start error : ' + e.message)
    return 'multiview start error, check log'
  }
}

// Listen for multiview Kodi STRM file requests
app.get('/multiview.strm', async function(req, res) {
  try {
    session.log('multiview.strm request : ' + req.url)

    delete req.headers.host

    var inputstream_property_name = 'inputstreamaddon'
    if ( req.query.version && (req.query.version == '18') ) {
      inputstream_property_name = 'inputstream.adaptive'
    }

    var body = '#KODIPROP:mimetype=application/vnd.apple.mpegurl' + "\n" + '#KODIPROP:' + inputstream_property_name + '=inputstream.adaptive' + "\n" + '#KODIPROP:inputstream.adaptive.manifest_type=hls' + "\n" + multiview_url

    var download_headers = {
      'Content-Disposition': 'attachment; filename="multiview.strm"'
    }
    res.writeHead(200, download_headers)

    res.end(body)
  } catch (e) {
    session.log('multiview.strm request error : ' + e.message)
    res.end('multiview.strm request error, check log')
  }
})