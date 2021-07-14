#!/usr/bin/env node

// index.js sets up web server and listens for and responds to URL requests

// Required Node packages
const minimist = require('minimist')
const root = require('root')
const path = require('path')
const url = require('url')
const assert = require('assert')
var crypto = require('crypto')

// Declare our session class for API activity, from the included session.js file
const sessionClass = require('./session.js')

// Define some valid variable values, the first one being the default
const VALID_DATES = [ 'today', 'yesterday' ]
const VALID_MEDIA_TYPES = [ 'Video', 'Audio', 'Spanish' ]
const VALID_LINK_TYPES = [ 'Embed', 'Stream', 'Chromecast', 'Advanced' ]
const VALID_START_FROM = [ 'Beginning', 'Live' ]
const VALID_INNING_HALF = [ '', 'top', 'bottom' ]
const VALID_INNING_NUMBER = [ '', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12' ]
const VALID_SCORES = [ 'Hide', 'Show' ]
const VALID_RESOLUTIONS = [ 'adaptive', '720p60', '720p', '540p', '504p', '360p', 'none'  ]
// Corresponding andwidths to display for above resolutions
const VALID_BANDWIDTHS = [ '', '6600k', '4160k', '2950k', '2120k', '1400k', '' ]
const VALID_AUDIO_TRACKS = [ 'all', 'English', 'English Radio', 'Radio Española' ]
const VALID_SKIP = [ 'off', 'breaks', 'pitches' ]
const VALID_FORCE_VOD = [ 'off', 'on' ]

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
    d: 'debug',
    l: 'logout',
    s: 'session',
    c: 'cache',
    v: 'version'
  },
  booleans: ['debug']
})

// Version
if (argv.version) return console.log(require('./package').version)

// Declare a session, pass debug flag to it
var session = new sessionClass(argv.debug)

// Clear cache (cache data, not images)
if (argv.cache) {
  session.log('Clearing cache...')
  session.clear_cache()
  session = new sessionClass(argv.debug)
}

// Clear session
if (argv.session) {
  session.log('Clearing session data...')
  session.clear_session_data()
  session = new sessionClass(argv.debug)
}

// Logout (also implies clearing session)
if (argv.logout) {
  session.log('Logging out...')
  session.logout()
  if (!argv.session) {
    session.clear_session_data()
  }
  session = new sessionClass(argv.debug)
}

// Declare web server
var app = root()

// Get appname from directory
var appname = path.basename(__dirname)

// Declare server, will fill in IP and port next
var server = ''

// Start web server listening on port
app.listen(argv.port || 9999, function(addr) {
  server = 'http://' + addr
  session.log(appname + ' started at ' + server)
})

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
      streamURL = 'https://www.radiantmediaplayer.com/media/rmp-segment/bbb-abr-aes/playlist.m3u8'
    } else {
      if ( req.query.resolution && (options.resolution == 'best') ) {
        options.resolution = VALID_RESOLUTIONS[1]
      } else {
        options.resolution = session.returnValidItem(req.query.resolution, VALID_RESOLUTIONS)
      }
      options.audio_track = session.returnValidItem(req.query.audio_track, VALID_AUDIO_TRACKS)
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

// Store previous key, for return without decoding
var prevUrl
var prevKey
var getKey = function(url, headers, cb) {
  if (url == prevUrl) return cb(null, prevKey)

  session.debuglog('key request : ' + url)
  requestRetry(url, {encoding:null}, function(err, response) {
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
    session.streamVideo(u, opts, function(err, res) {
      if (err) {
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
          if ( (resolution == 'none') && (line.indexOf(',URI=') < 0) ) return
          if ( (audio_track != 'all') && (line.indexOf('NAME="'+audio_track+'"') > 0) ) {
            line = line.replace('AUTOSELECT=NO','AUTOSELECT=YES')
            line = line.replace('AUTOSELECT=YES','AUTOSELECT=YES,DEFAULT=YES')
          } else if ( (audio_track != 'all') && (line.indexOf('NAME="'+audio_track+'"') === -1) ) {
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
          inning_half = 'none'
          inning_number = ''
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

            if ( (inning_half != 'none') || (inning_number != '') ) {
              let inning_index = 0
              if ( inning_number > 0 ) {
                inning_index = (inning_number * 2)
                if ( inning_half == 'top' ) inning_index = inning_index - 1
              }
              if ( (typeof session.temp_cache[contentId].inning_offsets[inning_index].start !== 'undefined') && (time_counter < session.temp_cache[contentId].inning_offsets[inning_index].start) ) {
                session.debuglog('skipping ' + time_counter + ' before ' + session.temp_cache[contentId].inning_offsets[inning_index].start)
                skip_next = true
                if ( discontinuity ) {
                  return null
                } else {
                  discontinuity = true
                  return '#EXT-X-DISCONTINUITY'
                }
              } else {
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

    let gameDate = session.liveDate(15)
    if ( req.query.date ) {
      if ( req.query.date == VALID_DATES[1] ) {
        gameDate = session.yesterdayDate()
      } else if ( req.query.date != VALID_DATES[0] ) {
        gameDate = req.query.date
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

    var scan_mode = session.data.scan_mode
    if ( req.query.scan_mode && (req.query.scan_mode != session.data.scan_mode) ) {
      scan_mode = req.query.scan_mode
      session.setScanMode(req.query.scan_mode)
    }

    var body = '<html><head><meta charset="UTF-8"><meta http-equiv="Content-type" content="text/html;charset=UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no"><title>' + appname + '</title><link rel="icon" href="favicon.svg"><style type="text/css">input[type=text],input[type=button]{-webkit-appearance:none;-webkit-border-radius:0}body{width:480px;color:lightgray;background-color:black;font-family:Arial,Helvetica,sans-serif}a{color:darkgray}button{color:lightgray;background-color:black}button.default{color:black;background-color:lightgray}table{width:100%;pad}table,th,td{border:1px solid darkgray;border-collapse:collapse}th,td{padding:5px}.tinytext{font-size:.8em}</style><script type="text/javascript">var date="' + gameDate + '";var mediaType="' + mediaType + '";var resolution="' + resolution + '";var audio_track="' + audio_track + '";var force_vod="' + force_vod + '";var inning_half="' + inning_half + '";var inning_number="' + inning_number + '";var skip="' + skip + '";var linkType="' + linkType + '";var startFrom="' + startFrom + '";var scores="' + scores + '";var scan_mode="' + scan_mode + '";function reload(){var newurl="/?";if ((date != "' + VALID_DATES[0] + '") && (date != "' + session.liveDate(15) + '")){newurl+="date="+date+"&"}if (mediaType != "' + VALID_MEDIA_TYPES[0] + '"){newurl+="mediaType="+mediaType+"&"}if (mediaType=="Video"){if (resolution != "' + VALID_RESOLUTIONS[0] + '"){newurl+="resolution="+resolution+"&"}if (audio_track != "' + VALID_AUDIO_TRACKS[0] + '"){newurl+="audio_track="+audio_track+"&"}}if (linkType=="Stream"){if (force_vod != "' + VALID_FORCE_VOD[0] + '"){newurl+="force_vod="+force_vod+"&"}}if (inning_half != "' + VALID_INNING_HALF[0] + '"){newurl+="inning_half="+inning_half+"&"}if (inning_number != "' + VALID_INNING_NUMBER[0] + '"){newurl+="inning_number="+inning_number+"&"}if (skip != "' + VALID_SKIP[0] + '"){newurl+="skip="+skip+"&"}if (linkType != "' + VALID_LINK_TYPES[0] + '"){newurl+="linkType="+linkType+"&"}if (linkType=="Embed"){if (startFrom != "' + VALID_START_FROM[0] + '"){newurl+="startFrom="+startFrom+"&"}}if (scores != "' + VALID_SCORES[0] + '"){newurl+="scores="+scores+"&"}if (scan_mode != "' + session.data.scan_mode + '"){newurl+="scan_mode="+scan_mode+"&"}window.location=newurl.substring(0,newurl.length-1)}</script></head><body><h1>' + appname + '</h1>' + "\n"

    body += '<p>Date: <input type="date" id="gameDate" value="' + gameDate + '"/> '
    for (var i = 0; i < VALID_DATES.length; i++) {
      body += '<button onclick="date=\'' + VALID_DATES[i] + '\';reload()">' + VALID_DATES[i] + '</button> '
    }
    body += '</p>' + "\n" + '<p class="tinytext">Updated ' + session.getCacheUpdatedDate(gameDate) + '</p>' + "\n"

    body += '<p>Media Type: '
    for (var i = 0; i < VALID_MEDIA_TYPES.length; i++) {
      body += '<button '
      if ( mediaType == VALID_MEDIA_TYPES[i] ) body += 'class="default" '
      body += 'onclick="mediaType=\'' + VALID_MEDIA_TYPES[i] + '\';reload()">' + VALID_MEDIA_TYPES[i] + '</button> '
    }
    body += '</p>' + "\n"

    body += '<p>Link Type: '
    for (var i = 0; i < VALID_LINK_TYPES.length; i++) {
      body += '<button '
      if ( linkType == VALID_LINK_TYPES[i] ) body += 'class="default" '
      body += 'onclick="linkType=\'' + VALID_LINK_TYPES[i] + '\';reload()">' + VALID_LINK_TYPES[i] + '</button> '
    }
    body += '</p>' + "\n"

    body += '<p>'
    if ( linkType == 'Embed' ) {
      body += 'Start From: '
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
      body += 'Inning: '
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
      body += '</select></p>' + "\n"
    }

    body += '<p>Scores: '
    for (var i = 0; i < VALID_SCORES.length; i++) {
      body += '<button '
      if ( scores == VALID_SCORES[i] ) body += 'class="default" '
      body += 'onclick="scores=\'' + VALID_SCORES[i] + '\';reload()">' + VALID_SCORES[i] + '</button> '
    }
    body += '</p>' + "\n"

    body += "<p><table>" + "\n"

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

    for (var j = 0; j < cache_data.dates[0].games.length; j++) {
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
          pitchers += cache_data.dates[0].games[j].teams['away'].probablePitcher.lastName
        } else {
          pitchers += 'TBD'
        }
        pitchers += ' vs '
        if ( cache_data.dates[0].games[j].teams['home'].probablePitcher && cache_data.dates[0].games[j].teams['home'].probablePitcher.lastName ) {
          pitchers += cache_data.dates[0].games[j].teams['home'].probablePitcher.lastName
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
                  if ( (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON') || (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ARCHIVE') ) {
                    let mediaId = cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaId
                    if ( (mediaType == 'MLBTV') && session.data.media && session.data.media[mediaId] && session.data.media[mediaId].blackout ) {
                      body += teamabbr + ': <s>' + station + '</s>'
                    } else {
                      let mediaId = cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaId
                      let thislink = '/' + link
                      let querystring
                      querystring = '?mediaId=' + mediaId
                      if ( linkType == 'embed' ) {
                        if ( cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON' ) {
                          querystring += '&isLive=true'
                        }
                        if ( startFrom != 'Beginning' ) querystring += '&startFrom=' + startFrom
                      }
                      if ( mediaType == 'MLBTV' ) {
                        if ( resolution != VALID_RESOLUTIONS[0] ) querystring += '&resolution=' + resolution
                        if ( audio_track != VALID_AUDIO_TRACKS[0] ) querystring += '&audio_track=' + audio_track
                        if ( inning_half != 'none' ) querystring += '&inning_half=' + inning_half
                        if ( inning_number != '' ) querystring += '&inning_number=' + inning_number
                        if ( skip != 'off' ) querystring += '&skip=' + skip
                        if ( (inning_half != 'none') || (inning_number != '') || (skip != 'off') ) {
                          let contentId = cache_data.dates[0].games[j].content.media.epg[k].items[x].contentId
                          querystring += '&contentId=' + contentId
                        }
                      }
                      if ( (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON') && (force_vod != 'off') ) {
                        querystring += '&force_vod=' + force_vod
                      }
                      body += teamabbr + ': <a href="' + thislink + querystring + '">' + station + '</a>' + ', '
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
        if ( mediaType == 'MLBTV' ) {
          if ( (cache_data.dates[0].games[j].content.media.epgAlternate[0].title == 'Extended Highlights') && cache_data.dates[0].games[j].content.media.epgAlternate[0].items[0] ) {
            body += '<a href="/' + link + '?src=' + encodeURIComponent(cache_data.dates[0].games[j].content.media.epgAlternate[0].items[0].playbacks[3].url) + '&resolution=' + resolution + '">CG</a>, '
          }
          if ( (cache_data.dates[0].games[j].content.media.epgAlternate[1].title == 'Daily Recap') && cache_data.dates[0].games[j].content.media.epgAlternate[1].items[0] ) {
            body += '<a href="/' + link + '?src=' + encodeURIComponent(cache_data.dates[0].games[j].content.media.epgAlternate[1].items[0].playbacks[3].url) + '&resolution=' + resolution + '">Recap</a>, '
          }
        }
        if ( body.substr(-2) == ', ' ) {
          body = body.slice(0, -2)
        }
        body += "</td>"
        body += "</tr>" + "\n"
      }
    }
    body += "</table></p>" + "\n"

    // Rename parameter back before displaying further links
    if ( mediaType == 'MLBTV' ) {
      mediaType = 'Video'
    }

    if ( mediaType == 'Video' ) {
        body += '<p>Video: '
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

        body += '<p>Audio: '
        for (var i = 0; i < VALID_AUDIO_TRACKS.length; i++) {
          body += '<button '
          if ( audio_track == VALID_AUDIO_TRACKS[i] ) body += 'class="default" '
          body += 'onclick="audio_track=\'' + VALID_AUDIO_TRACKS[i] + '\';reload()">' + VALID_AUDIO_TRACKS[i] + '</button> '
        }
        body += '</p>' + "\n"

        body += '<p>Skip: '
        for (var i = 0; i < VALID_SKIP.length; i++) {
          body += '<button '
          if ( skip == VALID_SKIP[i] ) body += 'class="default" '
          body += 'onclick="skip=\'' + VALID_SKIP[i] + '\';reload()">' + VALID_SKIP[i] + '</button> '
        }
        body += '</p>' + "\n"
    }

    if ( (linkType == 'stream') && (gameDate == session.liveDate()) ) {
      body += '<p>Force VOD: '
      for (var i = 0; i < VALID_FORCE_VOD.length; i++) {
        body += '<button '
        if ( force_vod == VALID_FORCE_VOD[i] ) body += 'class="default" '
        body += 'onclick="force_vod=\'' + VALID_FORCE_VOD[i] + '\';reload()">' + VALID_FORCE_VOD[i] + '</button> '
      }
      body += '<span class="tinytext">(if client does not support seeking in live streams)</span></p>' + "\n"
    }

    let media_center_link = '/live-stream-games/' + gameDate.replace(/-/g,'/') + '?linkType=' + linkType
    body += '<p><a href="' + media_center_link + '">Media Center View</a></p>' + "\n"

    body += '<table><tr><td>' + "\n"

    body += '<p>Live Channel Playlist and XMLTV Guide:<p>' + "\n"

    body += '<p>Scan Mode: '
    let options = ['off', 'on']
    for (var i = 0; i < options.length; i++) {
      body += '<button '
      if ( scan_mode == options[i] ) body += 'class="default" '
      body += 'onclick="scan_mode=\'' + options[i] + '\';reload()">' + options[i] + '</button> '
    }
    body += ' <span class="tinytext">(ON plays sample for all stream requests)</span></p>' + "\n"

    body += '<p>All: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '">guide.xml</a></p>' + "\n"

    body += '<p>By team: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&includeTeams=ari">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeTeams=ari">guide.xml</a></p>' + "\n"

    body += '<p>Exclude a team + national: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&excludeTeams=ari,national">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&excludeTeams=ari,national">guide.xml</a></p>' + "\n"

    body += '</td></tr></table>' + "\n"

    body += '<p>Sample video: <a href="/embed.html">Embed</a> | <a href="/stream.m3u8">Stream</a> | <a href="/chromecast.html">Chromecast</a> | <a href="/advanced.html">Advanced</a></p>' + "\n"

    body += '<p>Bookmarklets for MLB.com: <a href="javascript:(function(){let x=document.querySelector(\'#mlbtv-stats-panel\');if(x.style.display==\'none\'){x.style.display=\'initial\';}else{x.style.display=\'none\';}})();">Boxscore</a> | <a href="javascript:(function(){let x=document.querySelector(\'.mlbtv-header-container\');if(x.style.display==\'none\'){let y=document.querySelector(\'.mlbtv-players-container\');y.style.display=\'none\';x.style.display=\'initial\';setTimeout(function(){y.style.display=\'initial\';},15);}else{x.style.display=\'none\';}})();">Scoreboard</a> | <a href="javascript:(function(){let x=document.querySelector(\'.mlbtv-container--footer\');if(x.style.display==\'none\'){let y=document.querySelector(\'.mlbtv-players-container\');y.style.display=\'none\';x.style.display=\'initial\';setTimeout(function(){y.style.display=\'initial\';},15);}else{x.style.display=\'none\';}})();">Linescore</a> | <a href="javascript:(function(){let x=document.querySelector(\'#mlbtv-stats-panel\');if(x.style.display==\'none\'){x.style.display=\'initial\';}else{x.style.display=\'none\';}x=document.querySelector(\'.mlbtv-header-container\');if(x.style.display==\'none\'){x.style.display=\'initial\';}else{x.style.display=\'none\';}x=document.querySelector(\'.mlbtv-container--footer\');if(x.style.display==\'none\'){let y=document.querySelector(\'.mlbtv-players-container\');y.style.display=\'none\';x.style.display=\'initial\';setTimeout(function(){y.style.display=\'initial\';},15);}else{x.style.display=\'none\';}})();">All</a></p>' + "\n"

    body += '<script>var datePicker=document.getElementById("gameDate");function changeDate(e){date=datePicker.value;reload()}function removeDate(e){datePicker.removeEventListener("change",changeDate,false);datePicker.addEventListener("blur",changeDate,false);if(e.keyCode===13){date=datePicker.value;reload()}}datePicker.addEventListener("change",changeDate,false);datePicker.addEventListener("keypress",removeDate,false)</script>' + "\n"

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

  let video_url = '/stream.m3u8'
  let urlArray = req.url.split('?')
  if ( (urlArray.length == 2) ) {
    video_url += '?' + urlArray[1]
  }
  session.debuglog('embed src : ' + video_url)

  let startFrom = 'Beginning'
  if ( req.query.startFrom ) {
    startFrom = req.query.startFrom
  }

  let isLive = 'false'
  if ( req.query.isLive ) {
    isLive = req.query.isLive
  }

  // Adapted from https://hls-js.netlify.app/demo/basic-usage.html
  var body = '<html><head><meta charset="UTF-8"><meta http-equiv="Content-type" content="text/html;charset=UTF-8"><title>' + appname + ' player</title><link rel="icon" href="favicon.svg"><style type="text/css">input[type=text],input[type=button]{-webkit-appearance:none;-webkit-border-radius:0}body{background-color:black;color:lightgrey;font-family:Arial,Helvetica,sans-serif}video{width:100% !important;height:auto !important;max-width:1280px}input[type=number]::-webkit-inner-spin-button{opacity:1}button{color:lightgray;background-color:black}button.default{color:black;background-color:lightgray}</style><script>function goBack(){var prevPage=window.location.href;window.history.go(-1);setTimeout(function(){if(window.location.href==prevPage){window.location.href="/"}}, 500)}function toggleAudio(x){var elements=document.getElementsByClassName("audioButton");for(var i=0;i<elements.length;i++){elements[i].className="audioButton"}document.getElementById("audioButton"+x).className+=" default";hls.audioTrack=x}function changeTime(x){video.currentTime+=x}function changeRate(x){let newRate=Math.round((Number(document.getElementById("playback_rate").value)+x)*10)/10;if((newRate<=document.getElementById("playback_rate").max) && (newRate>=document.getElementById("playback_rate").min)){document.getElementById("playback_rate").value=newRate.toFixed(1);video.defaultPlaybackRate=video.playbackRate=document.getElementById("playback_rate").value}}function myKeyPress(e){if(e.key=="ArrowRight"){changeTime(10)}else if(e.key=="ArrowLeft"){changeTime(-10)}else if(e.key=="ArrowUp"){changeRate(0.1)}else if(e.key=="ArrowDown"){changeRate(-0.1)}}</script></head><body onkeydown="myKeyPress(event)"><script src="https://hls-js.netlify.app/dist/hls.js"></script><video id="video" controls></video><script>var video=document.getElementById("video");if(Hls.isSupported()){var hls=new Hls('

  if ( startFrom != 'Live' ) {
    body += '{startPosition:0,liveSyncDuration:32400,liveMaxLatencyDuration:32410}'
  }

  body += ');hls.loadSource("' + video_url + '");hls.attachMedia(video);hls.on(Hls.Events.MEDIA_ATTACHED,function(){video.muted=true;video.play()});hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function(){var audioSpan=document.getElementById("audioSpan");var audioButtons="";for(var i=0;i<hls.audioTracks.length;i++){audioButtons+=\'<button id="audioButton\'+i+\'" class="audioButton\';if(i==0){audioButtons+=\' default\'}audioButtons+=\'" onclick="toggleAudio(\'+i+\')">\'+hls.audioTracks[i]["name"]+"</button> "}audioSpan.innerHTML=audioButtons})}else if(video.canPlayType("application/vnd.apple.mpegurl")){video.src="' + video_url + '";video.addEventListener("canplay",function(){video.play()})}</script><p>Skip: <button onclick="changeTime(-10)">- 10 s</button> <button onclick="changeTime(10)">+ 10 s</button> <button onclick="changeTime(30)">+ 30 s</button> <button onclick="changeTime(90)">+ 90 s</button>  <button onclick="changeTime(120)">+ 120 s</button> '

  if ( isLive == 'true' ) {
    body += '<button onclick="changeTime(video.duration-10)">Live</button> '
  }

  body += '<button id="airplay">AirPlay</button></p><p>Playback rate: <input type="number" value=1.0 min=0.1 max=16.0 step=0.1 id="playback_rate" size="8" style="width: 4em" onchange="video.defaultPlaybackRate=video.playbackRate=this.value"></p><p>Audio: <button onclick="video.muted=!video.muted">Toggle Mute</button> <span id="audioSpan"></span></p><p><button onclick="goBack()">Back</button></p><script>var airPlay=document.getElementById("airplay");if(window.WebKitPlaybackTargetAvailabilityEvent){video.addEventListener("webkitplaybacktargetavailabilitychanged",function(event){switch(event.availability){case "available":airPlay.style.display="inline";break;default:airPlay.style.display="none"}airPlay.addEventListener("click",function(){video.webkitShowPlaybackTargetPicker()})})}else{airPlay.style.display="none"}</script></body></html>'
  res.end(body)
})

// Listen for advanced embed request, redirect to online demo hls.js player
app.get('/advanced.html', function(req, res) {
  session.log('advanced embed request : ' + req.url)

  delete req.headers.host

  let video_url = '/stream.m3u8'
  let urlArray = req.url.split('?')
  if ( (urlArray.length == 2) ) {
    video_url += '?' + urlArray[1]
  }
  session.debuglog('advanced embed src : ' + video_url)

  res.redirect('http://hls-js.netlify.app/demo/?src=' + encodeURIComponent(server + video_url))
})

// Listen for Chromecast request, redirect to chromecast.link player
app.get('/chromecast.html', function(req, res) {
  session.log('chromecast request : ' + req.url)

  delete req.headers.host

  let video_url = '/stream.m3u8'
  let urlArray = req.url.split('?')
  if ( (urlArray.length == 2) ) {
    video_url += '?' + urlArray[1]
  }
  session.debuglog('chromecast src : ' + video_url)

  // Include "server" with URL so it points to IP address (as Chromecast cannot resolve local domain names)
  res.redirect('https://chromecast.link#title=' + appname + '&content=' + encodeURIComponent(server + video_url))
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