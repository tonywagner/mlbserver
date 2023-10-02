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
const VALID_CONTROLS = [ 'Show', 'Hide' ]
const VALID_INNING_HALF = [ '', 'top', 'bottom' ]
const VALID_INNING_NUMBER = [ '', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12' ]
const VALID_SCORES = [ 'Hide', 'Show' ]
const VALID_RESOLUTIONS = [ 'adaptive', '720p60', '720p', '540p', '504p', '360p', 'none'  ]
const DEFAULT_MULTIVIEW_RESOLUTION = '504p'
// Corresponding andwidths to display for above resolutions
const DISPLAY_BANDWIDTHS = [ '', '6600k', '4160k', '2950k', '2120k', '1400k', '' ]
const VALID_AUDIO_TRACKS = [ 'all', 'English', 'English Radio', 'Radio Española', 'Alternate English', 'Alternate Spanish', 'none' ]
const DISPLAY_AUDIO_TRACKS = [ 'all', 'TV', 'Radio', 'Spanish', 'Alt.', 'Alt. Spanish', 'none' ]
const ALTERNATE_AUDIO_TRACKS = [ VALID_AUDIO_TRACKS[4], VALID_AUDIO_TRACKS[5] ]
const DEFAULT_MULTIVIEW_AUDIO_TRACK = 'English'
const VALID_SKIP = [ 'off', 'breaks', 'idle time', 'pitches', 'commercials' ]
const VALID_PAD = [ 'off', 'on' ]
const VALID_FORCE_VOD = [ 'off', 'on' ]
const VALID_SCAN_MODES = [ 'off', 'on' ]

const SAMPLE_STREAM_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'

const SECONDS_PER_SEGMENT = 5

// for favorites: text, then background, based on https://teamcolors.jim-nielsen.com/
const TEAM_COLORS = {'ARI': ['E3D4AD', 'A71930'], 'ATL': ['13274F', 'CE1141'], 'BAL': ['000000', 'DF4601'], 'BOS': ['0D2B56', 'BD3039'], 'CHC': ['CC3433', '0E3386'], 'CWS': ['000000', 'C4CED4'], 'CIN': ['FFFFFF', 'C6011F'], 'CLE': ['002B5C', 'E31937'], 'COL': ['C4CED4', '333366'], 'DET': ['0C2C56', 'FFFFFF'], 'HOU': ['002D62', 'EB6E1F'], 'KC': ['C09A5B', '004687'], 'LAA': ['FFFFFF', 'BA0021'], 'LAD': ['FFFFFF', '005A9C'], 'MIA': ['0077C8', 'FF6600'], 'MIL': ['0A2351', 'B6922E'], 'MIN': ['D31145', '002B5C'], 'NYM': ['002D72', 'FF5910'], 'NYY': ['FFFFFF', '003087'], 'OAK': ['003831', 'EFB21E'], 'PHI': ['284898', 'E81828'], 'PIT': ['000000', 'FDB827'], 'STL': ['FEDB00', 'C41E3A'], 'SD': ['FEC325', '7F411C'], 'SF': ['000000', 'FD5A1E'], 'SEA': ['C4CED4', '005C5C'], 'TB': ['092C5C', '8FBCE6'], 'TEX': ['003278', 'C0111F'], 'TOR': ['FFFFFF', '134A8E'], 'WSH': ['AB0003', '11225B']}

// Gamechanger resolutions
const GAMECHANGER_RESOLUTIONS = {
  '504p': {
    'resolution': '896x504',
    'frame_rate': '29.97',
    'url_bandwidth': '1800',
    'bandwidth': '2120',
    'codec': '4d001f'
  },
  '360p': {
    'resolution': '640x360',
    'frame_rate': '29.97',
    'url_bandwidth': '1200',
    'bandwidth': '1400',
    'codec': '4d001f'
  },
  '540p': {
    'resolution': '960x540',
    'frame_rate': '29.97',
    'url_bandwidth': '2500',
    'bandwidth': '2950',
    'codec': '4d001f'
  },
  '720p': {
    'resolution': '1280x720',
    'frame_rate': '29.97',
    'url_bandwidth': '3500',
    'bandwidth': '4160',
    'codec': '640028'
  },
  '720p60': {
    'resolution': '1280x720',
    'frame_rate': '59.94',
    'url_bandwidth': '5600',
    'bandwidth': '6600',
    'codec': '640028'
  }
}
const GAMECHANGER_LIST_SIZE = 6
const GAMECHANGER_RESPONSE_HEADERS = {"statusCode":200,"headers":{"content-type":"application/x-mpegURL","access-control-allow-origin":"*"}}

// Basic command line arguments, if specified:
// --port or -p (primary port to run on; defaults to 9999 if not specified)
// --debug or -d (false if not specified)
// --version or -v (returns package version number)
// --logout or -l (logs out and clears session)
// --session or -s (clears session)
// --cache or -c (clears cache)
// --env or -e (use environment variables instead of command line arguments; necessary for Docker)
//
// Advanced command line arguments:
// --account_username (email address, default will use stored credentials or prompt user to enter them)
// --account_password (default will use stored credentials or prompt user to enter them)
// --zip_code (optional, for USA blackout labels, will prompt if not set or stored)
// --country (optional, for international blackout labels -- see list of accepted names in session.js -- defaults to USA if not set or stored)
// --fav_teams (optional, comma-separated list of favorite team abbreviations from https://github.com/tonywagner/mlbserver/blob/master/session.js#L26 -- will prompt if not set or stored)
// --data_directory (defaults to app directory, must already exist if set to something else; should match storage volume for Docker)
// --free (optional, free account, highlights free games)
// --multiview_port (port for multiview streaming; defaults to 1 more than primary port, or 10000)
// --multiview_path (where to create the folder for multiview encoded files; defaults to data directory)
// --ffmpeg_path (path to ffmpeg binary to use for multiview encoding; default downloads a binary using ffmpeg-static)
// --ffmpeg_encoder (ffmpeg video encoder to use for multiview; default is the software encoder libx264)
// --ffmpeg_logging (if present, logs all ffmpeg output -- useful for experimenting or troubleshooting)
// --page_username (username to protect pages; default is no protection)
// --page_password (password to protect pages; default is no protection)
// --content_protect (specify the content protection key to include as a URL parameter, if page protection is enabled)
// --gamechanger_delay (specify extra delay for the gamechanger switches in 10 second increments, default is 0)
var argv = minimist(process.argv, {
  alias: {
    p: 'port',
    d: 'debug',
    l: 'logout',
    s: 'session',
    c: 'cache',
    v: 'version',
    e: 'env'
  },
  boolean: ['ffmpeg_logging', 'debug', 'logout', 'session', 'cache', 'version', 'free', 'env'],
  string: ['port', 'account_username', 'account_password', 'zip_code', 'country', 'fav_teams', 'multiview_port', 'multiview_path', 'ffmpeg_path', 'ffmpeg_encoder', 'page_username', 'page_password', 'content_protect', 'gamechanger_delay', 'data_directory']
})

if (argv.env) argv = process.env

// Version
var version = require('./package').version
console.log('Version ' + version)
if (argv.version) return

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
const defaultEncoder = 'libx264'
const ffmpegEncoder = argv.ffmpeg_encoder || defaultEncoder

// Declare web server
var app = root()

// Get appname from directory
var appname = path.basename(__dirname)

// Multiview server variables
var hls_base = 'multiview'
var multiview_stream_name = 'master.m3u8'
var multiview_url_path = '/' + hls_base + '/' + multiview_stream_name
if ( session.protection.content_protect ) multiview_url_path += '?content_protect=' + session.protection.content_protect
session.setMultiviewStreamURLPath(multiview_url_path)
var ffmpeg_command
var ffmpeg_status = false

// Start web server listening on port
// and also multiview server on its port (next one if not defined otherwise)
let port = argv.port || 9999
let multiview_port = argv.multiview_port || port + 1
session.setPorts(port, multiview_port)
app.listen(port, function(addr) {
  session.log(appname + ' started at http://' + addr)
  session.debuglog('multiview port ' + multiview_port)
  session.debuglog('multiview server started at http://' + addr.replace(':' + port, ':' + multiview_port) + multiview_url_path)
  if (ffmpegEncoder == defaultEncoder) {
    session.debuglog('warning: multiview is set to use software encoding -- see the readme for how to configure hardware encoding (to reduce multiview CPU usage and improve multiview performance)')
  }
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

// Listen for clear cache requests
app.get('/clearcache', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  try {
    session.requestlog('clearcache', req)

    session.log('Clearing cache...')
    session.clear_cache()
    session = new sessionClass(argv)

    let server = 'http://' + req.headers.host
    res.redirect(server)
  } catch (e) {
    session.log('clearcache request error : ' + e.message)
    res.end('clearcache request error, check log')
  }
})

// Listen for stream requests
app.get('/stream.m3u8', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  try {
    session.requestlog('stream.m3u8', req)

    let mediaId
    let gamePk
    let contentId
    let streamURL
    let options = {}
    let includeBlackouts = 'false'
    let urlArray = req.url.split('?')
    if ( (urlArray.length == 1) || ((session.data.scan_mode == VALID_SCAN_MODES[1]) && req.query.team) || (!req.query.team && !req.query.src && !req.query.highlight_src && !req.query.eventURL && !req.query.event && !req.query.gamePk && !req.query.id && !req.query.mediaId && !req.query.contentId) ) {
      // load a sample encrypted HLS stream
      session.log('loading sample stream')
      options.resolution = VALID_RESOLUTIONS[0]
      streamURL = SAMPLE_STREAM_URL
      options.referer = 'https://hls-js-dev.netlify.app/'
    } else {
      if ( req.query.resolution && (options.resolution == 'best') ) {
        options.resolution = VALID_RESOLUTIONS[1]
      } else {
        options.resolution = session.returnValidItem(req.query.resolution, VALID_RESOLUTIONS)
      }
      options.audio_track = session.returnValidItem(req.query.audio_track, VALID_AUDIO_TRACKS)
      options.alternate_audio_tracks = {}
      options.force_vod = req.query.force_vod || VALID_FORCE_VOD[0]

      options.inning_half = req.query.inning_half || VALID_INNING_HALF[0]
      options.inning_number = req.query.inning_number || VALID_INNING_NUMBER[0]
      options.skip = req.query.skip || VALID_SKIP[0]
      options.pad = req.query.pad || VALID_PAD[0]
      if ( options.pad != VALID_PAD[0] ) {
        // if pad is selected, pick a random number of times to repeat the last segment (between 1-3 hours)
        options.pad = Math.floor(Math.random() * (7200 / SECONDS_PER_SEGMENT)) + (3600 / SECONDS_PER_SEGMENT)
      }

      if (req.query.includeBlackouts) {
        includeBlackouts = req.query.includeBlackouts
      }

      if ( req.query.src ) {
        streamURL = req.query.src
      } else if ( req.query.highlight_src ) {
        streamURL = req.query.highlight_src
      } else if ( req.query.event ) {
        streamURL = await session.getEventStreamURL(req.query.event.toUpperCase())
      } else {
        if ( req.query.gamePk ) {
          gamePk = req.query.gamePk
          if ( !req.query.mediaId && !req.query.contentId ) {
            streamURL = await session.getEventStreamURL(false, gamePk)
          }
        }
        if ( !streamURL ) {
          if ( req.query.contentId ) {
            contentId = req.query.contentId
          }
          for (var i=0; i<ALTERNATE_AUDIO_TRACKS.length; i++) {
            if ( req.query[ALTERNATE_AUDIO_TRACKS[i]] ) {
              options.alternate_audio_tracks[ALTERNATE_AUDIO_TRACKS[i]] = req.query[ALTERNATE_AUDIO_TRACKS[i]]
            }
          }
          if ( req.query.mediaId ) {
            mediaId = req.query.mediaId
          } else if ( req.query.gamePk && req.query.contentId ) {
            let mediaInfo = await session.getMediaIdFromContentId(gamePk, contentId)
            if ( mediaInfo ) {
              mediaId = mediaInfo.mediaId
              if ( mediaInfo.alternateAudioTracks ) {
                for (const [key, value] of Object.entries(mediaInfo.alternateAudioTracks)) {
                  options.alternate_audio_tracks[key] = value
                }
              }
            } else {
              session.log('no matching game found ' + req.url)
            }
          } else if ( req.query.team ) {
            let mediaType = req.query.mediaType || VALID_MEDIA_TYPES[0]
            let level = req.query.level || 'MLB'
            let mediaInfo = await session.getMediaId(decodeURIComponent(req.query.team), decodeURIComponent(level), mediaType, req.query.date, req.query.game, includeBlackouts)
            if ( mediaInfo ) {

              if ( mediaInfo.gamePk ) {
                streamURL = await session.getEventStreamURL(false, mediaInfo.gamePk)
              } else {
                mediaId = mediaInfo.mediaId
                contentId = mediaInfo.contentId
                if ( mediaInfo.alternateAudioTracks ) {
                  for (const [key, value] of Object.entries(mediaInfo.alternateAudioTracks)) {
                    options.alternate_audio_tracks[key] = value
                  }
                }
              }
            } else {
              session.log('no matching game found ' + req.url)
            }
          }

          if ( !streamURL ) {
            if ( !mediaId ) {
              session.log('failed to get mediaId : ' + req.url)
              res.end('')
              return
            } else {
              session.debuglog('mediaId : ' + mediaId)
              streamURL = await session.getStreamURL(mediaId)
            }
          }
        }
      }
    }

    if (streamURL) {
      session.debuglog('using streamURL : ' + streamURL)

      if ( streamURL.includes('master_radio') ) {
        options.resolution = VALID_RESOLUTIONS[0]
      }

      // resolve any alternate audio mediaIds into playlist URLs, if necessary
      if ( options.alternate_audio_tracks ) {
        for (const [key, value] of Object.entries(options.alternate_audio_tracks)) {
          if ( (options.audio_track == VALID_AUDIO_TRACKS[0]) || (options.audio_track == key) ) {
            let audioStreamURL = await session.getStreamURL(value)
            let audioPlaylistURL = audioStreamURL.replace(/\/(master_radio_complete|master_radio)/g,'/48K/48_complete')
            options.alternate_audio_tracks[key] = audioPlaylistURL
          } else {
            delete options.alternate_audio_tracks[key]
          }
        }
      }

      if ( (options.inning_half != VALID_INNING_HALF[0]) || (options.inning_number != VALID_INNING_NUMBER[0]) || (options.skip != VALID_SKIP[0]) ) {
        if ( contentId ) {
          options.contentId = contentId

          let skip_type = VALID_SKIP.indexOf(options.skip)
          // for commercial skip, just use the gdfp playlists and skip the ad inserts
          if ( skip_type == 4 ) {
            let new_streamURL = streamURL.replace('master_desktop_complete', 'master_desktop_complete_gdfp')
            if ( new_streamURL == streamURL ) {
              new_streamURL = streamURL.replace('master_desktop', 'master_desktop_gdfp')
            }
            session.debuglog('skipping commercials using gdfp playlist ' + new_streamURL)
            streamURL = new_streamURL
          } else {
            await session.getSkipMarkers(contentId, skip_type, options.inning_number, options.inning_half)
          }
        }
      }

      if ( req.query.referer ) {
        options.referer = req.query.referer
        session.debuglog('sending referer : ' + options.referer)
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

var getKey = function(url, headers, cb) {
  if ( session.temp_cache.prevKeys[url] ) {
    return cb(null, session.temp_cache.prevKeys[url])
  }

  session.debuglog('key request : ' + url)
  requestRetry(url, headers, function(err, response) {
    if (err) return cb(err)
    let key = response.body
    session.debuglog('key returned ' + key)
    session.temp_cache.prevKeys[url] = key
    cb(null, key)
  })
}

function getOriginFromURL(url) {
  let pathArray = url.split('/')
  return pathArray[0] + '//' + pathArray[2]
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
    var headers = {}
    var referer = false
    var referer_parameter = ''
    if ( options.referer ) {
      referer = decodeURIComponent(options.referer)
      headers.referer = referer
      headers.origin = getOriginFromURL(referer)
      session.debuglog('found stream referer  : ' + referer)
      referer_parameter = '&referer=' + encodeURIComponent(options.referer)
    }
    requestRetry(streamURL, headers, function(err, response) {
      if (err) return res.error(err)

      session.debuglog(response.body)

      var body = response.body.replace(/^\s+|\s+$/g, '').split('\n')

      // check if HLS
      if ( body[0] != '#EXTM3U' ) {
        session.log('not a valid hls stream at ' + streamURL)
        return
      }

      let resolution = options.resolution || VALID_RESOLUTIONS[0]
      let audio_track = options.audio_track || VALID_AUDIO_TRACKS[0]
      let alternate_audio_tracks = options.alternate_audio_tracks || {}
      let force_vod = options.force_vod || VALID_FORCE_VOD[0]

      let inning_half = options.inning_half || VALID_INNING_HALF[0]
      let inning_number = options.inning_number || VALID_INNING_NUMBER[0]
      let skip = options.skip || VALID_SKIP[0]
      let pad = options.pad || VALID_PAD[0]
      let contentId = options.contentId || false

      if ( (inning_number > 0) && (inning_half == VALID_INNING_HALF[0]) ) {
        inning_half = VALID_INNING_HALF[1]
      }

      var content_protect = ''
      if ( session.protection.content_protect ) {
        content_protect = '&content_protect=' + session.protection.content_protect
      }

      // Some variables for controlling audio/video stream selection, if specified
      var video_track_matched = false
      var audio_track_matched = false
      var frame_rate = '29.97'
      if ( (resolution != VALID_RESOLUTIONS[0]) && (resolution != VALID_RESOLUTIONS[VALID_RESOLUTIONS.length-1]) ) {
        if ( resolution.endsWith('p60') ) {
          frame_rate = '59.94'
          resolution = resolution.slice(0, -3)
        } else if ( resolution.endsWith('p') ) {
          resolution = resolution.slice(0, -1)
        }
      }

      var segment_playlist = false
      var segment_found = false

      body = body
      .map(function(line) {
        let newurl = ''

        // Check if segment playlist instead of master
        if ( line.startsWith('#EXTINF:') ) {
          if ( !segment_playlist ) {
            session.debuglog('segment playlist instead of master')
            segment_playlist = true
          }
          segment_found = true
          return line
        } else if ( segment_found ) {
          segment_found = false
          return '/ts?url='+encodeURIComponent(url.resolve(streamURL, line.trim())) + content_protect + referer_parameter
        }

        // Omit keyframe tracks
        if ( line.startsWith('#EXT-X-I-FRAME-STREAM-INF:') ) {
          return
        }

        // Omit captions track when TV audio is excluded or no video is specified
        if ( line.startsWith('#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,') && ((audio_track != VALID_AUDIO_TRACKS[0]) || (audio_track != VALID_AUDIO_TRACKS[1]) || (resolution == VALID_RESOLUTIONS[VALID_RESOLUTIONS.length-1])) ) {
          return
        }

        // Parse audio tracks to only include matching one, if specified
        if ( line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO') ) {
          // if we've already returned our desired audio track, we can skip subsequent ones
          if ( audio_track_matched ) return

          // user specified no audio tracks
          if ( audio_track == VALID_AUDIO_TRACKS[VALID_AUDIO_TRACKS.length-1] ) {
            audio_track_matched = true
            return
          }

          // we'll append to this and output track(s) at the end of this code block
          let audio_output = ''

          // default TV audio
          if ( !line.includes(',URI=') ) {
            if ( audio_track == VALID_AUDIO_TRACKS[1] ) {
              return line
            } else if ( audio_track == VALID_AUDIO_TRACKS[0] ) {
              audio_output += line
            }
          } else {
            if ( (audio_track == VALID_AUDIO_TRACKS[0]) || (audio_track == VALID_AUDIO_TRACKS[2]) || (audio_track == VALID_AUDIO_TRACKS[3]) ) {
              // if user specified home radio or home Spanish audio track, check if this one matches
              if ( (audio_track == VALID_AUDIO_TRACKS[2]) || (audio_track == VALID_AUDIO_TRACKS[3]) ) {
                if ( line.includes('NAME="'+audio_track+'"') || line.includes('NAME="'+audio_track.substring(0,audio_track.length-1)+'"') ) {
                  audio_track_matched = true
                  line = line.replace('AUTOSELECT=NO','AUTOSELECT=YES')
                  if ( !line.includes(',DEFAULT=YES') ) line = line.replace('AUTOSELECT=YES','AUTOSELECT=YES,DEFAULT=YES')
                } else {
                  return
                }
              }

              if ( line.match ) {
                //var parsed = line.match(/URI="([^"]+)"?$/)
                var parsed = line.match(',URI="([^"]+)"')
                if ( parsed[1] ) {
                  newurl = '/playlist?url='+encodeURIComponent(url.resolve(streamURL, parsed[1].trim()))
                  if ( force_vod != VALID_FORCE_VOD[0] ) newurl += '&force_vod=on'
                  if ( inning_half != VALID_INNING_HALF[0] ) newurl += '&inning_half=' + inning_half
                  if ( inning_number != VALID_INNING_NUMBER[0] ) newurl += '&inning_number=' + inning_number
                  if ( skip != VALID_SKIP[0] ) newurl += '&skip=' + skip
                  if ( pad != VALID_PAD[0] ) newurl += '&pad=' + pad
                  if ( contentId ) newurl += '&contentId=' + contentId
                  newurl += content_protect + referer_parameter

                  // if user specified "none" for video track
                  if ( resolution == VALID_RESOLUTIONS[VALID_RESOLUTIONS.length-1] ) {
                    audio_track_matched = true
                    audio_output = line.replace(parsed[0],'') + "\n" + '#EXT-X-STREAM-INF:BANDWIDTH=50000,CODECS="mp4a.40.2",AUDIO="aac"' + "\n" + newurl
                  } else {
                    if (audio_output != '') audio_output += "\n"
                    audio_output += line.replace(parsed[1],newurl)
                  }
                }
              }
            }
          }

          // process any alternate radio streams we've passed in
          if ( !audio_track_matched ) {
            for (const [key, value] of Object.entries(alternate_audio_tracks)) {
              if ( audio_track_matched ) break

              session.debuglog('processing ' + key + ' stream ' + value)
              newurl = '/playlist?url='+encodeURIComponent(value)
              if ( force_vod != VALID_FORCE_VOD[0] ) newurl += '&force_vod=on'
              if ( inning_half != VALID_INNING_HALF[0] ) newurl += '&inning_half=' + inning_half
              if ( inning_number != VALID_INNING_NUMBER[0] ) newurl += '&inning_number=' + inning_number
              if ( skip != VALID_SKIP[0] ) newurl += '&skip=' + skip
              if ( pad != VALID_PAD[0] ) newurl += '&pad=' + pad
              if ( contentId ) newurl += '&contentId=' + contentId
              newurl += content_protect + referer_parameter

              // if user specified "none" for video track
              if ( resolution == VALID_RESOLUTIONS[VALID_RESOLUTIONS.length-1] ) {
                audio_track_matched = true
                audio_output = '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="' + key + '",LANGUAGE="'
                if ( key == ALTERNATE_AUDIO_TRACKS[1] ) {
                  audio_output += 'es'
                } else {
                  audio_output += 'en'
                }
                audio_output += '",AUTOSELECT=YES,DEFAULT=YES' + "\n" + '#EXT-X-STREAM-INF:BANDWIDTH=50000,CODECS="mp4a.40.2",AUDIO="aac"' + "\n" + newurl
              } else {
                if (audio_output != '') audio_output += "\n"
                audio_output += '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="' + key + '",AUTOSELECT=YES,DEFAULT='
                if ( audio_track == key ) {
                  audio_track_matched = true
                  audio_output += 'YES'
                } else {
                  audio_output += 'NO'
                }
                audio_output += ',URI="' + newurl + '"'
              }
            }

            // clear after processing
            alternate_audio_tracks = {}
          }

          if ( audio_output != '' ) return audio_output

          return
        }

        // Parse video tracks to only include matching one, if specified
        if ( line.startsWith('#EXT-X-STREAM-INF:BANDWIDTH=') ) {
          if ( resolution == VALID_RESOLUTIONS[VALID_RESOLUTIONS.length-1] ) {
            return
          } else {
            if ( resolution === VALID_RESOLUTIONS[0] ) {
              return line
            } else {
              if ( line.indexOf(resolution+',FRAME-RATE='+frame_rate) > 0 ) {
                video_track_matched = true
                return line
              } else {
                return
              }
            }
          }
        }

        // Skip key in archive master playlists
        if ( line.startsWith('#EXT-X-SESSION-KEY:METHOD=AES-128') ) {
          return
        }

        // Pass through any remaining caption tracks
        if ( line.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,LANGUAGE="eng",URI="') ) {
          var parsed = line.match(',URI="([^"]+)"')
          if ( parsed[1] ) {
            newurl = '/playlist?url='+encodeURIComponent(url.resolve(streamURL, parsed[1].trim()))
            return '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,LANGUAGE="eng",URI="' + newurl + '"'
          }
          return
        }

        if (line[0] === '#') {
          return line
        }

        if ( (resolution === VALID_RESOLUTIONS[0]) || (video_track_matched) ) {
          video_track_matched = false
          newurl = encodeURIComponent(url.resolve(streamURL, line.trim()))
          if ( force_vod != VALID_FORCE_VOD[0] ) newurl += '&force_vod=on'
          if ( inning_half != VALID_INNING_HALF[0] ) newurl += '&inning_half=' + inning_half
          if ( inning_number != VALID_INNING_NUMBER[0] ) newurl += '&inning_number=' + inning_number
          if ( skip != VALID_SKIP[0] ) newurl += '&skip=' + skip
          if ( pad != VALID_PAD[0] ) newurl += '&pad=' + pad
          if ( contentId ) newurl += '&contentId=' + contentId
          newurl += content_protect + referer_parameter
          return '/playlist?url='+newurl
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

  requestRetry(streamURL, headers, function(err, res) {
    if (err) return res.error(err)
    req()
  })
}


// Listen for playlist requests
app.get('/playlist', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  session.requestlog('playlist', req, true)

  delete req.headers.host

  var u = req.query.url
  session.debuglog('playlist url : ' + u)

  var referer = false
  var referer_parameter = ''
  if ( req.query.referer ) {
    referer = decodeURIComponent(req.query.referer)
    session.debuglog('found playlist referer : ' + referer)
    referer_parameter = '&referer=' + encodeURIComponent(req.query.referer)
  }

  var force_vod = req.query.force_vod || VALID_FORCE_VOD[0]
  var inning_half = req.query.inning_half || VALID_INNING_HALF[0]
  var inning_number = req.query.inning_number || VALID_INNING_NUMBER[0]
  var skip = req.query.skip || VALID_SKIP[0]
  var pad = req.query.pad || VALID_PAD[0]
  var contentId = req.query.contentId || false

  var req = function () {
    var headers = {}
    if ( referer ) {
      headers.referer = referer
      headers.origin = getOriginFromURL(referer)
    }

    requestRetry(u, headers, function(err, response) {
      if (err) return res.error(err)

      //session.debuglog(response.body)

      var body = response.body.replace(/^\s+|\s+$/g, '').split('\n')

      // check if HLS
      if ( body[0] != '#EXTM3U' ) {
        session.log('not a valid hls stream at ' + u)
        return
      }

      var key
      var iv
      var skip_markers
      var skip_marker_index = 0
      var time_counter = 0.0
      var skip_next = false
      var discontinuity = false

      var content_protect = ''
      if ( session.protection.content_protect ) {
        content_protect = '&content_protect=' + session.protection.content_protect
      }

      // if skipping commercials, filter the playlist to remove ad insertion domains
      if ( skip == 'commercials' ) {
        session.debuglog('filtering commercial breaks')
        let new_body = []
        for (var i=0; i<body.length; i++) {
          if ( body[i].includes('dai.google.com') ) {
            new_body.pop()
            if ( new_body[new_body.length-1] != '#EXT-X-DISCONTINUITY' ) {
              new_body.push('#EXT-X-DISCONTINUITY')
            }
          } else {
            new_body.push(body[i])
          }
        }
        body = new_body
      } else if ( (contentId) && ((inning_half != VALID_INNING_HALF[0]) || (inning_number != VALID_INNING_NUMBER[0]) || (skip != VALID_SKIP[0])) && (typeof session.temp_cache[contentId] !== 'undefined') && (typeof session.temp_cache[contentId].skip_markers !== 'undefined') ) {
        session.debuglog('pulling skip markers from temporary cache')
        skip_markers = session.temp_cache[contentId].skip_markers
      } else {
        session.debuglog('not using skip markers from temporary cache')
      }

      body = body
      .map(function(line) {
        // Skip blank lines
        if (line.trim() == '') return null

        if ( skip_markers && skip_markers[skip_marker_index] ) {
          if ( skip_next ) {
            skip_next = false
            return null
          }

          if ( line.startsWith('#EXTINF:') ) {
            time_counter += parseFloat(line.substring(8, line.length-1))
            session.debuglog('checking skip marker at ' + time_counter)

            while (skip_markers[skip_marker_index] && (skip_markers[skip_marker_index].break_end < time_counter)) {
              skip_marker_index++
            }
            if (skip_markers[skip_marker_index] && (time_counter >= skip_markers[skip_marker_index].break_start) && (time_counter < skip_markers[skip_marker_index].break_end)) {
              session.debuglog('skipping ' + time_counter)
              skip_next = true
              if ( discontinuity ) {
                return null
              } else {
                discontinuity = true
                return '#EXT-X-DISCONTINUITY'
              }
            } else {
              session.debuglog('keeping ' + time_counter)
              discontinuity = false
            }
          }
        }

        if ( line.indexOf('-KEY:METHOD=AES-128') > 0 ) {
          session.debuglog('key line : ' + line)
          var parsed = line.match(/URI="([^"]+)"(?:,IV=(.+))?$/)
          if ( parsed ) {
            if ( parsed[1].startsWith('http') ) {
              key = parsed[1]
              session.debuglog('key url : ' + key)
            } else if ( key.startsWith('data:;base64,') ) {
              let newparsed = key.split(',')
              key = newparsed[1]
              session.debuglog('found key data : ' + key)
            } else {
              key = url.resolve(u, parsed[1])
              session.debuglog('resolved key url : ' + key)
            }
            if (parsed[2]) iv = parsed[2].slice(2).toLowerCase()
          }
          return null
        }

        if (line[0] === '#') return line

        let newline = '/ts?url='+encodeURIComponent(url.resolve(u, line.trim())) + content_protect + referer_parameter
        if ( key ) newline += '&key='+encodeURIComponent(key) + '&iv='+encodeURIComponent(iv)

        return newline
      })
      .filter(function(line) {
        return line
      })
      .join('\n')+'\n'

      if ( pad != VALID_PAD[0] ) {
        let body_array = body.trim().split('\n')
        let last_segment_index = body_array.length-1
        if ( body_array[last_segment_index] == '#EXT-X-ENDLIST' ) {
          session.debuglog('padding archive stream with extra segments')
          last_segment_index--
          while ( !body_array[last_segment_index].startsWith('#EXTINF:' + SECONDS_PER_SEGMENT) ) {
            last_segment_index--
          }
          last_segment_inf = body_array[last_segment_index]
          last_segment = body_array[last_segment_index+1]
          let pad_lines = '#EXT-X-DISCONTINUITY' + '\n' + last_segment_inf + '\n' + last_segment + '\n'
          session.debuglog(pad_lines)
          for (i=0; i<pad; i++) {
            body += pad_lines
          }
          body += '#EXT-X-ENDLIST' + '\n'
        }
      }
      if ( force_vod != VALID_FORCE_VOD[0] ) body += '#EXT-X-ENDLIST' + '\n'
      session.debuglog(body)
      respond(response, res, Buffer.from(body))
    })
  }

  return req()

  requestRetry(u, headers, function(err, res) {
    if (err) return res.error(err)
    req()
  })
})

// Listen for ts requests (video segments) and decode them
app.get('/ts', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  session.requestlog('ts', req, true)

  delete req.headers.host

  var u = req.query.url
  session.debuglog('ts url : ' + u)

  var headers = {encoding:null}

  if ( req.query.referer ) {
    session.debuglog('found segment referer : ' + req.query.referer)
    referer = decodeURIComponent(req.query.referer)
    headers.referer = referer
    headers.origin = getOriginFromURL(referer)
  }

  requestRetry(u, headers, function(err, response) {
    if (err) return res.error(err)
    if (!req.query.key) return respond(response, res, response.body)

    try {
      var ku = req.query.key
      if ( ku.startsWith('http') ) {
        getKey(ku, headers, function(err, key) {
          if (err) return res.error(err)

          var iv = Buffer.from(req.query.iv, 'hex')
          session.debuglog('iv : 0x'+req.query.iv)

          var dc = crypto.createDecipheriv('aes-128-cbc', key, iv)
          var buffer = Buffer.concat([dc.update(response.body), dc.final()])

          respond(response, res, buffer)
        })
      } else {
        var iv = Buffer.from(req.query.iv, 'hex')
        session.debuglog('iv : 0x'+req.query.iv)

        let key = Buffer.from(ku, "base64")

        var dc = crypto.createDecipheriv('aes-128-cbc', key, iv)
        var buffer = Buffer.concat([dc.update(response.body), dc.final()])

        respond(response, res, buffer)
      }
    } catch (e) {
      session.log('key decode error : ' + e.message)
      return respond(response, res, '')
    }
  })
})


// Listen for gamechanger.m3u master playlist requests
app.get('/gamechanger.m3u8', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  session.requestlog('gamechanger.m3u8', req, true)

  // use a random string as the identifier for this gamechanger (for caching purposes)
  var id = session.getRandomString(16)

  var resolution
  if ( req.query.resolution && (req.query.resolution == 'best') ) {
    resolution = VALID_RESOLUTIONS[1]
  } else {
    resolution = session.returnValidItem(req.query.resolution, VALID_RESOLUTIONS)
  }
  if ( resolution == VALID_RESOLUTIONS[0] ) {
    resolution = VALID_RESOLUTIONS[1]
  }

  var includeTeams = ''
  if ( req.query.includeTeams ) {
    includeTeams = '&includeTeams=' + req.query.includeTeams.toUpperCase()
    session.debuglog('Game changer including teams ' + includeTeams)
  }

  var excludeTeams = ''
  if ( req.query.excludeTeams ) {
    excludeTeams = '&excludeTeams=' + req.query.excludeTeams.toUpperCase()
    session.debuglog('Game changer excluding teams ' + excludeTeams)
  }

  var content_protect = ''
  if ( session.protection.content_protect ) {
    content_protect = '&content_protect=' + session.protection.content_protect
  }

  var body = '#EXTM3U' + '\n' + '#EXT-X-INDEPENDENT-SEGMENTS' + '\n' + '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="en",NAME="English",AUTOSELECT=YES,DEFAULT=YES' + '\n' + '#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID="cc",LANGUAGE="en",NAME="English",INSTREAM-ID="CC1",AUTOSELECT=YES,DEFAULT=YES' + '\n'

  for ( gamechanger_resolution in GAMECHANGER_RESOLUTIONS ) {
    if ( resolution == gamechanger_resolution ) {
      body += '#EXT-X-STREAM-INF:BANDWIDTH=' + GAMECHANGER_RESOLUTIONS[gamechanger_resolution].bandwidth + '000,RESOLUTION=' + GAMECHANGER_RESOLUTIONS[gamechanger_resolution].resolution + ',FRAME-RATE=' + GAMECHANGER_RESOLUTIONS[gamechanger_resolution].frame_rate + ',CODECS="mp4a.40.2,avc1.' + GAMECHANGER_RESOLUTIONS[gamechanger_resolution].codec + '",CLOSED-CAPTIONS="cc",AUDIO="aac"' + '\n' + '/gamechangerplaylist?id=' + id + '&resolution=' + gamechanger_resolution + includeTeams + excludeTeams + content_protect + '\n'
      break
    }
  }

  session.debuglog(body)

  let response = {"statusCode":200,"headers":{"content-type":"application/x-mpegURL","access-control-allow-origin":"*"}}

  respond(response, res, Buffer.from(body))
})


// Listen for gamechanger playlist requests
app.get('/gamechangerplaylist', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  session.requestlog('gamechangerplaylist', req, true)

  let gamechangerAccess = new Date()

  delete req.headers.host

  var id = req.query.id || null
  if ( !id ) {
    session.log('Game changer error : no id specified')
    respond(GAMECHANGER_RESPONSE_HEADERS, res, Buffer.from(''))
  } else {
    var game_changer_title = 'Game changer ' + id + ' '

    var resolution = req.query.resolution || VALID_RESOLUTIONS[1]

    var includeTeams = req.query.includeTeams || []
    if ( includeTeams.length > 0 ) includeTeams = includeTeams.split(',')

    var excludeTeams = req.query.excludeTeams || []
    if ( excludeTeams.length > 0 ) excludeTeams = excludeTeams.split(',')

    var req = async function () {
      var headers = {}

      var content_protect = ''
      if ( session.protection.content_protect ) {
        content_protect = '&content_protect=' + session.protection.content_protect
      }

      // if 30+ seconds since our last access, assume stream was stopped and reset this gamechanger
      if ( !session.temp_cache.gamechanger || !session.temp_cache.gamechanger[id] || !session.temp_cache.gamechanger[id].segments || (session.temp_cache.gamechanger[id].segments.length == 0) || !session.temp_cache.gamechanger[id].lastAccess || (gamechangerAccess >= (new Date(new Date(session.temp_cache.gamechanger[id].lastAccess).getTime() + 30000))) ) {
        session.log(game_changer_title + 'starting/resetting gamechanger')
        await session.resetGameChanger(id, includeTeams, excludeTeams)
      }
      session.temp_cache.gamechanger[id].lastAccess = gamechangerAccess

      if ( !session.temp_cache.gamechanger.start || (gamechangerAccess < session.temp_cache.gamechanger.start) || !session.temp_cache.gamechanger.end || (gamechangerAccess > session.temp_cache.gamechanger.end) ) {
        session.log(game_changer_title + 'outside of games starting/ending, skipping')
        respond(GAMECHANGER_RESPONSE_HEADERS, res, Buffer.from(''))
      } else {
        let streamURL = await session.getBestGame(id)

        let discontinuity = false
        if ( streamURL && (streamURL != session.temp_cache.gamechanger[id].streamURL) ) {
          session.log(game_changer_title + 'game changed')
          session.temp_cache.gamechanger[id].streamURL = streamURL
          if ( session.temp_cache.gamechanger[id].segments.length == GAMECHANGER_LIST_SIZE ) {
            discontinuity = true
            session.temp_cache.gamechanger[id].discontinuitySequence++
          }
        }

        if ( !streamURL ) streamURL = session.temp_cache.gamechanger[id].streamURL

        if ( !streamURL ) {
          session.log(game_changer_title + 'no stream found')
          respond(GAMECHANGER_RESPONSE_HEADERS, res, Buffer.from(''))
        } else {
          // check for new segments
          if ( !session.temp_cache.gamechanger[id].playlist[resolution] || !session.temp_cache.gamechanger[id].lastAccess[resolution] || (gamechangerAccess >= (new Date(new Date(session.temp_cache.gamechanger[id].lastAccess[resolution]).getTime() + 1500))) ) {
            session.temp_cache.gamechanger[id].lastAccess[resolution] = gamechangerAccess
            session.debuglog(game_changer_title + 'checking for new segments')
            let u = streamURL + '/' + GAMECHANGER_RESOLUTIONS[resolution].url_bandwidth + 'K/' + GAMECHANGER_RESOLUTIONS[resolution].url_bandwidth + '_complete.m3u8'
            requestRetry(u, headers, function(err, response) {
              session.debuglog(game_changer_title + 'requested ' + u)
              if (err) return res.error(err)

              session.debuglog(response.body)

              var body = response.body.replace(/^\s+|\s+$/g, '').split('\n')

              // check if HLS
              if ( body[0] != '#EXTM3U' ) {
                session.log(game_changer_title + 'not a valid hls stream at ' + u)
                return
              }

              // find the new segments, and make sure all segments have valid keys
              let segments_to_key = []
              let new_segments = []
              let new_segments_complete = false
              let segment_count = 0
              for (var i=(body.length-1); i>=0; i--) {
                if ( body[i].startsWith('#EXTINF:') ) {
                  let line = url.resolve(u, body[i+1])
                  if ( !new_segments_complete ) {
                    session.debuglog(game_changer_title + 'found segment ' + line)
                    if ( discontinuity ) {
                      session.debuglog(game_changer_title + 'only getting newest segment after stream change')
                      segments_to_key.unshift({'extinf':body[i], 'ts':line})
                      new_segments_complete = true
                    } else if ( !discontinuity && (session.temp_cache.gamechanger[id].segments.length > 0) && (line == session.temp_cache.gamechanger[id].segments[session.temp_cache.gamechanger[id].segments.length-1].ts) ) {
                      session.debuglog(game_changer_title + 'found previous last segment')
                      new_segments_complete = true
                    } else if ( segment_count == GAMECHANGER_LIST_SIZE ) {
                      session.debuglog(game_changer_title + 'segments full')
                      if ( !discontinuity && (session.temp_cache.gamechanger[id].segments.length > 0) ) {
                        discontinuity = true
                        session.temp_cache.gamechanger[id].discontinuitySequence++
                      }
                      new_segments_complete = true
                    } else {
                      segments_to_key.unshift({'extinf':body[i], 'ts':line})
                    }
                  }
                  segment_count++
                } else if ( body[i].indexOf('-KEY:METHOD=AES-128') > 0 ) {
                  session.debuglog(game_changer_title + 'found key : ' + body[i])
                  var parsed = body[i].match(/URI="([^"]+)"(?:,IV=(.+))?$/)
                  let key = parsed[1]
                  let iv = parsed[2].slice(2).toLowerCase()
                  session.debuglog(game_changer_title + 'new segments to key: ' + JSON.stringify(segments_to_key))
                  for (var j=0; j<segments_to_key.length; j++) {
                    segments_to_key[j].key = key
                    segments_to_key[j].iv = iv
                  }
                  new_segments = segments_to_key.concat(new_segments)
                  segments_to_key = []
                  if ( new_segments_complete ) {
                    break
                  }
                }
              }

              if ( discontinuity && (new_segments.length > 0) ) {
                new_segments[0].discontinuity = true
              }
              session.debuglog(game_changer_title + 'new segments : ' + JSON.stringify(new_segments))

              // remove stored segments
              while ( session.temp_cache.gamechanger[id].segments.length > (GAMECHANGER_LIST_SIZE - new_segments.length) ) {
                session.debuglog(game_changer_title + 'removing old segment')
                session.temp_cache.gamechanger[id].segments.shift()
                session.temp_cache.gamechanger[id].sequence++
              }
              session.debuglog(game_changer_title + 'removing old segments complete')

              // append new segments to cache
              session.temp_cache.gamechanger[id].segments = session.temp_cache.gamechanger[id].segments.concat(new_segments)
              //session.debuglog(game_changer_title + 'new segments appended : ' + JSON.stringify(session.temp_cache.gamechanger[id].segments))

              // now generate playlists
              session.temp_cache.gamechanger[id].playlist[resolution] = '#EXTM3U' + '\n' + '#EXT-X-VERSION:6' + '\n' + '#EXT-X-TARGETDURATION:6' + '\n' + '#EXT-X-MEDIA-SEQUENCE:' + session.temp_cache.gamechanger[id].sequence + '\n' + '#EXT-X-DISCONTINUITY-SEQUENCE:' + session.temp_cache.gamechanger[id].discontinuitySequence + '\n'
              for (var i=0; i<session.temp_cache.gamechanger[id].segments.length; i++) {
                if ( session.temp_cache.gamechanger[id].segments[i].discontinuity ) {
                  session.temp_cache.gamechanger[id].playlist[resolution] += '#EXT-X-DISCONTINUITY' + '\n'
                }
                session.temp_cache.gamechanger[id].playlist[resolution] += session.temp_cache.gamechanger[id].segments[i].extinf + '\n' + '/ts?url=' + encodeURIComponent(session.temp_cache.gamechanger[id].segments[i].ts) + '&key='+encodeURIComponent(session.temp_cache.gamechanger[id].segments[i].key) + '&iv='+encodeURIComponent(session.temp_cache.gamechanger[id].segments[i].iv) + content_protect + '\n'
              }

              session.debuglog(game_changer_title + 'playlist ' + session.temp_cache.gamechanger[id].playlist[resolution])
              respond(GAMECHANGER_RESPONSE_HEADERS, res, Buffer.from(session.temp_cache.gamechanger[id].playlist[resolution]))
            })
            session.debuglog(game_changer_title + 'check for new segments complete')
          } else {
            session.debuglog(game_changer_title + 'using stored playlist')
            respond(GAMECHANGER_RESPONSE_HEADERS, res, Buffer.from(session.temp_cache.gamechanger[id].playlist[resolution]))
          }
        }
      }
    }

    return req()

    requestRetry(u, headers, function(err, res) {
      if (err) return res.error(err)
      req()
    })
  }
})

// Protect pages by password, or content by content_protect url parameter
async function protect(req, res) {
  if (argv.page_username && argv.page_password) {
    if ( !session.protection.content_protect || !req.query.content_protect || (req.query.content_protect != session.protection.content_protect) ) {
      if ( !session.protection.content_protect || !req.query.content_protect || !req.query.content_protect[0] || (req.query.content_protect[0] != session.protection.content_protect) ) {
        const reject = () => {
          res.setHeader('www-authenticate', 'Basic')
          res.error(401, ' Not Authorized')
          return false
        }

        const authorization = req.headers.authorization

        if(!authorization) {
          return reject()
        }

        const [username, password] = Buffer.from(authorization.replace('Basic ', ''), 'base64').toString().split(':')

        if(! (username === argv.page_username && password === argv.page_password)) {
          return reject()
        }
      }
    }
  }
  return true
}

function getLastName(fullName) {
  let indexOfSpace = fullName.indexOf(' ');

  if (indexOfSpace === -1) {
    return fullName;
  }

  return fullName.substring(indexOfSpace + 1);
}

// Server homepage, base URL
app.get('/', async function(req, res) {
  try {
    if ( ! (await protect(req, res)) ) return

    session.requestlog('homepage', req)

    let server = 'http://' + req.headers.host
    let multiview_server = server.replace(':' + session.data.port, ':' + session.data.multiviewPort)

    let gameDate = session.liveDate()
    let today = gameDate
    let yesterday = session.yesterdayDate()
    let todayUTCHours = session.getTodayUTCHours()
    let curDate = new Date()
    if ( req.query.date ) {
      if ( req.query.date == VALID_DATES[1] ) {
        gameDate = yesterday
      } else if ( req.query.date != VALID_DATES[0] ) {
        gameDate = req.query.date
      }
    } else {
      let utcHours = curDate.getUTCHours()
      if ( (utcHours >= todayUTCHours) && (utcHours < YESTERDAY_UTC_HOURS) ) {
        gameDate = yesterday
      }
    }

    var levels = session.getLevels()
    var level_labels = Object.keys(levels)
    var default_level = level_labels[0]
    var level = default_level
    if ( req.query.level ) {
      level = decodeURIComponent(req.query.level)
    }
    if ( typeof levels[level] === 'undefined' ) {
      level = default_level
    }

    var level_ids = levels[level]
    var default_org = level_labels[level_labels.length-1]
    var org = default_org
    var team_ids = ''
    if ( req.query.org ) {
      org = decodeURIComponent(req.query.org)
      if ( typeof session.getAffiliateTeamIds(org) === 'undefined' ) {
        org = default_org
      } else {
        team_ids += session.getTeamIds(org) + ',' + session.getAffiliateTeamIds(org)
        level = default_org
      }
    } else if ( level_ids == levels['MLB'] ) {
      team_ids = session.getTeamIds()
      for (let i=0; i<session.credentials.fav_teams.length; i++) {
        if ( session.credentials.fav_teams[i] != '' ) {
          level_ids = levels['All']
          team_ids += ',' + session.getAffiliateTeamIds(session.credentials.fav_teams[i])
        }
      }
    }
    let cache_name = gameDate
    if ( level_ids != levels['MLB'] ) {
      cache_name += '.' + level_ids
    }
    if ( team_ids != '' ) {
      cache_name += '.' + team_ids
    }

    var cache_data = await session.getDayData(gameDate, false, level_ids, team_ids)

    var linkType = VALID_LINK_TYPES[0]
    if ( req.query.linkType ) {
      linkType = req.query.linkType
      session.setLinkType(linkType)
    }
    var startFrom = VALID_START_FROM[0]
    if ( req.query.startFrom ) {
      startFrom = req.query.startFrom
    }
    var controls = VALID_CONTROLS[0]
    if ( req.query.controls ) {
      controls = req.query.controls
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
    var pad = VALID_PAD[0]
    if ( req.query.pad ) {
      pad = req.query.pad
    }

    var scan_mode = session.data.scan_mode
    if ( req.query.scan_mode && (req.query.scan_mode != session.data.scan_mode) ) {
      scan_mode = req.query.scan_mode
      session.setScanMode(req.query.scan_mode)
    }

    var content_protect = ''
    var content_protect_a = ''
    var content_protect_b = ''
    if ( session.protection.content_protect ) {
      content_protect = session.protection.content_protect
      content_protect_a = '?content_protect=' + content_protect
      content_protect_b = '&content_protect=' + content_protect
    }

    var body = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-type" content="text/html;charset=UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no"><title>' + appname + '</title><link rel="icon" href="favicon.svg' + content_protect_a + '"><style type="text/css">input[type=text],input[type=button]{-webkit-appearance:none;-webkit-border-radius:0}body{width:480px;color:lightgray;background-color:black;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:none}a{color:darkgray}button{color:lightgray;background-color:black}button.default{color:black;background-color:lightgray}table{width:100%;pad}table,th,td{border:1px solid darkgray;border-collapse:collapse}th,td{padding:5px}.tinytext,textarea,input[type="number"]{font-size:.8em}textarea{width:380px}.freegame,.freegame a{color:green}.blackout,.blackout a{text-decoration:line-through}'

    // Highlights CSS
    //max-height:calc(100vh-110px);
    body += '.modal{display:none;position:fixed;z-index:1;padding-top:100px;left:0;top:0;width:100%;height:100%;overflow:auto;-webkit-overflow-scrolling:touch;background-color:rgb(0,0,0);background-color:rgba(0,0,0,0.4)}.modal-content{background-color:#fefefe;margin:auto;padding:10px;border:1px solid #888;width:360px;color:black}#highlights a{color:black}.close{color:black;float:right;font-size:28px;font-weight:bold;}#highlights a:hover,#highlights a:focus,.close:hover,.close:focus{color:gray;text-decoration:none;cursor:pointer;}'

    // Tooltip CSS
    body += '.tooltip{position:relative;display:inline-block;border-bottom: 1px dotted gray;}.tooltip .tooltiptext{font-size:.8em;visibility:hidden;width:360px;background-color:gray;color:white;text-align:left;padding:5px;border-radius:6px;position:absolute;z-index:1;top:100%;left:75%;margin-left:-30px;}.tooltip:hover .tooltiptext{visibility:visible;}'

    body += '</style><script type="text/javascript">' + "\n";

    // Define option variables in page
    body += 'var date="' + gameDate + '";var level="' + level + '";var org="' + org + '";var mediaType="' + mediaType + '";var resolution="' + resolution + '";var audio_track="' + audio_track + '";var force_vod="' + force_vod + '";var inning_half="' + inning_half + '";var inning_number="' + inning_number + '";var skip="' + skip + '";var pad="' + pad + '";var linkType="' + linkType + '";var startFrom="' + startFrom + '";var scores="' + scores + '";var controls="' + controls + '";var scan_mode="' + scan_mode + '";var content_protect="' + content_protect + '";' + "\n"

    // Reload function, called after options change
    body += 'var defaultDate="' + today + '";var curDate=new Date();var utcHours=curDate.getUTCHours();if ((utcHours >= ' + todayUTCHours + ') && (utcHours < ' + YESTERDAY_UTC_HOURS + ')){defaultDate="' + yesterday + '"}function reload(){var newurl="/?";if (date != defaultDate){var urldate=date;if (date == "' + today + '"){urldate="today"}else if (date == "' + yesterday + '"){urldate="yesterday"}newurl+="date="+urldate+"&"}if (level != "' + default_level + '"){newurl+="level="+encodeURIComponent(level)+"&"}if (org != "All"){newurl+="org="+encodeURIComponent(org)+"&"}if (mediaType != "' + VALID_MEDIA_TYPES[0] + '"){newurl+="mediaType="+mediaType+"&"}if (mediaType=="Video"){if (resolution != "' + VALID_RESOLUTIONS[0] + '"){newurl+="resolution="+resolution+"&"}if (audio_track != "' + VALID_AUDIO_TRACKS[0] + '"){newurl+="audio_track="+encodeURIComponent(audio_track)+"&"}else if (resolution == "none"){newurl+="audio_track="+encodeURIComponent("' + VALID_AUDIO_TRACKS[2] + '")+"&"}if (inning_half != "' + VALID_INNING_HALF[0] + '"){newurl+="inning_half="+inning_half+"&"}if (inning_number != "' + VALID_INNING_NUMBER[0] + '"){newurl+="inning_number="+inning_number+"&"}if (skip != "' + VALID_SKIP[0] + '"){newurl+="skip="+skip+"&";}}if (pad != "' + VALID_PAD[0] + '"){newurl+="pad="+pad+"&";}if (linkType != "' + VALID_LINK_TYPES[0] + '"){newurl+="linkType="+linkType+"&"}if (linkType=="' + VALID_LINK_TYPES[0] + '"){if (startFrom != "' + VALID_START_FROM[0] + '"){newurl+="startFrom="+startFrom+"&"}if (controls != "' + VALID_CONTROLS[0] + '"){newurl+="controls="+controls+"&"}}if (linkType=="Stream"){if (force_vod != "' + VALID_FORCE_VOD[0] + '"){newurl+="force_vod="+force_vod+"&"}}if (scores != "' + VALID_SCORES[0] + '"){newurl+="scores="+scores+"&"}if (scan_mode != "' + session.data.scan_mode + '"){newurl+="scan_mode="+scan_mode+"&"}if (content_protect != ""){newurl+="content_protect="+content_protect+"&"}window.location=newurl.substring(0,newurl.length-1)}' + "\n"

    // Ajax function for multiview and highlights
    body += 'function makeGETRequest(url, callback){var request=new XMLHttpRequest();request.onreadystatechange=function(){if (request.readyState==4 && request.status==200){callback(request.responseText)}};request.open("GET", url);request.send();}' + "\n"

    // Multiview functions
    body += 'var excludeTeams=[];function parsemultiviewresponse(responsetext){if (responsetext == "started"){setTimeout(function(){document.getElementById("startmultiview").innerHTML="Restart";document.getElementById("stopmultiview").innerHTML="Stop"},15000)}else if (responsetext == "stopped"){setTimeout(function(){document.getElementById("stopmultiview").innerHTML="Stopped";document.getElementById("startmultiview").innerHTML="Start"},3000)}else{alert(responsetext)}}function addmultiview(e, teams=[], excludes=[]){var newvalue=e.value;for(var i=1;i<=4;i++){var valuefound = false;var oldvalue="";if(!e.checked){oldvalue=e.value;newvalue=""}if ((document.getElementById("multiview" + i).value == oldvalue) || ((oldvalue != "") && (document.getElementById("multiview" + i).value.startsWith(oldvalue)))){if ((newvalue != "") && (excludes.length > 0)){newvalue+="&excludeTeams="+excludeTeams.toString()}document.getElementById("multiview" + i).value=newvalue;valuefound=true;break}}if(e.checked && !valuefound){e.checked=false}for(var i=0;i<teams.length;i++){if(e.checked){excludeTeams.push(teams[i])}else{var index=excludeTeams.indexOf(teams[i]);if (index !== -1){excludeTeams.splice(index,1)}}}}function startmultiview(e){var count=0;var getstr="";for(var i=1;i<=4;i++){if (document.getElementById("multiview"+i).value != ""){count++;getstr+="streams="+encodeURIComponent(document.getElementById("multiview"+i).value)+"&sync="+encodeURIComponent(document.getElementById("sync"+i).value)+"&"}}if((count >= 1) && (count <= 4)){if (document.getElementById("faster").checked){getstr+="faster=true&dvr=true&"}else if (document.getElementById("dvr").checked){getstr+="dvr=true&"}if (document.getElementById("reencode").checked){getstr+="reencode=true&"}if (document.getElementById("park_audio").checked){getstr+="park_audio=true&"}if (document.getElementById("audio_url").value != ""){getstr+="audio_url="+encodeURIComponent(document.getElementById("audio_url").value)+"&";if (document.getElementById("audio_url_seek").value != "0"){getstr+="audio_url_seek="+encodeURIComponent(document.getElementById("audio_url_seek").value)}}e.innerHTML="starting...";makeGETRequest("/multiview?"+getstr, parsemultiviewresponse)}else{alert("Multiview requires between 1-4 streams to be selected")}return false}function stopmultiview(e){e.innerHTML="stopping...";makeGETRequest("/multiview", parsemultiviewresponse);return false}' + "\n"

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
      if ( ((VALID_DATES[i] == VALID_DATES[0]) && (gameDate == today)) || ((VALID_DATES[i] == VALID_DATES[1]) && (gameDate == yesterday)) ) body += 'class="default" '
      body += 'onclick="date=\'' + VALID_DATES[i] + '\';reload()">' + VALID_DATES[i] + '</button> '
    }
    body += '</p>' + "\n" + '<p><span class="tinytext">Updated ' + session.getCacheUpdatedDate(cache_name) + '</span></p>' + "\n"

    body += '<p><span class="tooltip">Level<span class="tooltiptext">Major or minor league level</span></span>: '
    for (const [key, value] of Object.entries(levels)) {
      body += '<button '
      if ( level == key ) body += 'class="default" '
      body += 'onclick="org=\'' + default_org + '\';level=\'' + key + '\';reload()">' + key + '</button> '
    }

    body += ' or <span class="tooltip">Org<span class="tooltiptext">Major league parent organization</span></span>: '
    body += '<select id="org" onchange="level=\'' + default_org + '\';org=this.value;reload()">'
    body += '<option value="' + default_org + '">' + default_org + '</option>'
    var orgs = session.getOrgs()
    for (var i = 0; i < orgs.length; i++) {
      body += '<option value="' + orgs[i] + '"'
      if ( org == orgs[i] ) body += ' selected'
      body += '>' + orgs[i] + '</option> '
    }
    body += '</select></p>' + "\n"

    body += '<p><span class="tooltip">Media Type<span class="tooltiptext">Video is TV broadcasts, Audio is English radio, and Spanish is Spanish radio (not available for all games).</span></span>: '
    for (var i = 0; i < VALID_MEDIA_TYPES.length; i++) {
      body += '<button '
      if ( mediaType == VALID_MEDIA_TYPES[i] ) body += 'class="default" '
      body += 'onclick="mediaType=\'' + VALID_MEDIA_TYPES[i] + '\';reload()">' + VALID_MEDIA_TYPES[i] + '</button> '
    }
    body += '</p>' + "\n"

    body += '<p><span class="tooltip">Link Type<span class="tooltiptext">Embed will play in your browser (with AirPlay support), Stream will give you a stream URL to open directly in media players like Kodi or VLC, Chromecast is a desktop browser-based casting site, and Advanced will play in your desktop browser with some extra tools and debugging information (Advanced may require you to disable insecure / mixed content blocking in your browser).<br><br>NOTE: Chromecast may not be able to resolve local domain names; if so, you can simply access this page (and thus the streams) using an IP address instead.</span></span>: '
    for (var i = 0; i < VALID_LINK_TYPES.length; i++) {
      body += '<button '
      if ( linkType == VALID_LINK_TYPES[i] ) body += 'class="default" '
      body += 'onclick="linkType=\'' + VALID_LINK_TYPES[i] + '\';reload()">' + VALID_LINK_TYPES[i] + '</button> '
    }
    body += '</p>' + "\n"

    body += '<p>'
    if ( linkType == VALID_LINK_TYPES[0] ) {
      body += '<span class="tooltip">Video Controls<span class="tooltiptext">Choose whether to show or hide controls on the embedded video page. Helpful to avoid timeline spoilers.</span></span>: '
      for (var i = 0; i < VALID_CONTROLS.length; i++) {
        body += '<button '
        if ( controls == VALID_CONTROLS[i] ) body += 'class="default" '
        body += 'onclick="controls=\'' + VALID_CONTROLS[i] + '\';reload()">' + VALID_CONTROLS[i] + '</button> '
      }
      body += '</p>' + "\n"

      body += '<p><span class="tooltip">Start From<span class="tooltiptext">For the embedded player only: Beginning will start playback at the beginning of the stream (may be 1 hour before game time for live games), and Live will start at the live point (if the event is live -- archive games should always start at the beginning). You can still seek anywhere.</span></span>: '
      for (var i = 0; i < VALID_START_FROM.length; i++) {
        body += '<button '
        if ( startFrom == VALID_START_FROM[i] ) body += 'class="default" '
        body += 'onclick="startFrom=\'' + VALID_START_FROM[i] + '\';reload()">' + VALID_START_FROM[i] + '</button> '
      }
      body += "\n"
      if ( mediaType == VALID_MEDIA_TYPES[0] ) {
        body += 'or '
      }
    }

    if ( mediaType == VALID_MEDIA_TYPES[0] ) {
      body += '<span class="tooltip">Inning<span class="tooltiptext">For video streams only: choose the inning to start with (and the score to display, if applicable). Inning number is relative -- for example, selecting inning 7 here will show inning 7 for scheduled 9-inning games, but inning 5 for scheduled 7-inning games, for example. If an inning number is specified, seeking to an earlier point will not be possible. Inning 0 (zero) should be the broadcast start time, if available. Default is the beginning of the stream. To use with radio, set the video track to "None".</span></span>: '
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

    body += '<p><span class="tooltip">Scores<span class="tooltiptext">Choose whether to show scores on this web page. Combine this with the inning option to only show scores through the specified inning.</span></span>: '
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
    if ( mediaType == VALID_MEDIA_TYPES[0] ) {
      mediaType = 'MLBTV'
    } else if ( mediaType == VALID_MEDIA_TYPES[2] ) {
      mediaType = VALID_MEDIA_TYPES[1]
      language = 'es'
    }
    if ( mediaType == VALID_MEDIA_TYPES[1] ) {
      mediaFeedType = 'type'
    }

    let link = linkType.toLowerCase() + '.html'
    if ( linkType == VALID_LINK_TYPES[1] ) {
      link = linkType.toLowerCase() + '.m3u8'
    } else {
      force_vod = VALID_FORCE_VOD[0]
    }
    var thislink = '/' + link

    let blackouts = {}

    if ( (mediaType == 'MLBTV') && ((level_ids == levels['MLB']) || level_ids.startsWith(levels['MLB'] + ',')) ) {
      // Recap Rundown beginning in 2023, disabled because it stopped working
      /*if ( (gameDate <= yesterday) && (gameDate >= '2023-03-31') && cache_data.dates && cache_data.dates[0] && cache_data.dates[0].games && (cache_data.dates[0].games.length > 0) ) {
        body += '<tr><td><span class="tooltip">VOD<span class="tooltiptext">Recap Rundown plays all of a day\'s recaps in order.</span></span></td><td>'
        let dateArray = gameDate.split('-')
        let querystring = '?event=recaprundown' + parseInt(dateArray[1]).toString() + '-' + parseInt(dateArray[2]).toString() + '-' + dateArray[0].substring(2,4)
        if ( linkType == VALID_LINK_TYPES[0] ) {
          if ( controls != VALID_CONTROLS[0] ) querystring += '&controls=' + controls
        }
        if ( resolution != VALID_RESOLUTIONS[0] ) querystring += '&resolution=' + resolution
        querystring += content_protect_b
        body += '<a href="' + thislink + querystring + '">Recap Rundown</a>'
        body += '</td></tr>' + "\n"
      }*/

      if ( (gameDate >= today) && cache_data.dates && cache_data.dates[0] && cache_data.dates[0].games && (cache_data.dates[0].games.length > 0) ) {
        blackouts = await session.get_blackout_games(cache_data.dates[0].games, true)
      }

      let currentDate = new Date()

      // Big Inning
      var big_inning
      if ( cache_data.dates && cache_data.dates[0] && (cache_data.dates[0].date >= today) && cache_data.dates[0].games && (cache_data.dates[0].games.length > 1) && cache_data.dates[0].games[0] && (cache_data.dates[0].games[0].seriesDescription == 'Regular Season') ) {
        // Scraped Big Inning schedule
        big_inning = await session.getBigInningSchedule(gameDate)

        // Generated Big Inning schedule (disabled)
        //big_inning = await session.generateBigInningSchedule(gameDate)
      }
      if ( big_inning && big_inning.start ) {
        body += '<tr><td><span class="tooltip">' + new Date(big_inning.start).toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }) + ' - ' + new Date(big_inning.end).toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }) + '<span class="tooltiptext">Big Inning is the live look-in and highlights show. <a href="https://www.mlb.com/live-stream-games/big-inning">See here for more information</a>.</span></span></td><td>'
        let compareStart = new Date(big_inning.start)
        compareStart.setMinutes(compareStart.getMinutes()-10)
        let compareEnd = new Date(big_inning.end)
        compareEnd.setHours(compareEnd.getHours()+1)
        if ( (currentDate >= compareStart) && (currentDate < compareEnd) ) {
          let querystring = '?event=biginning'
          let multiviewquerystring = querystring + '&resolution=' + DEFAULT_MULTIVIEW_RESOLUTION
          if ( linkType == VALID_LINK_TYPES[0] ) {
            if ( startFrom != VALID_START_FROM[0] ) querystring += '&startFrom=' + startFrom
            if ( controls != VALID_CONTROLS[0] ) querystring += '&controls=' + controls
          }
          if ( resolution != VALID_RESOLUTIONS[0] ) querystring += '&resolution=' + resolution
          if ( linkType == VALID_LINK_TYPES[1] ) {
            if ( force_vod != VALID_FORCE_VOD[0] ) querystring += '&force_vod=' + force_vod
          }
          querystring += content_protect_b
          multiviewquerystring += content_protect_b
          body += '<a href="' + thislink + querystring + '">Big Inning</a>'
          body += '<input type="checkbox" value="' + server + '/stream.m3u8' + multiviewquerystring + '" onclick="addmultiview(this)">'
        } else {
          body += 'Big Inning'
        }
        body += '</td></tr>' + "\n"
      }

      // Game Changer
      if ( (gameDate >= today) && cache_data.dates && cache_data.dates[0] && cache_data.dates[0].games && (cache_data.dates[0].games.length > 1) ) {
        let gameIndexes = await session.get_first_and_last_games(cache_data.dates[0].games, blackouts)
        if ( (typeof gameIndexes.firstGameIndex !== 'undefined') && (typeof gameIndexes.lastGameIndex !== 'undefined') && (gameIndexes.firstGameIndex !== gameIndexes.lastGameIndex) ) {
          let compareStart = new Date(cache_data.dates[0].games[gameIndexes.firstGameIndex].gameDate)
          let compareEnd = new Date(cache_data.dates[0].games[gameIndexes.lastGameIndex].gameDate)
          if ( cache_data.dates[0].games[gameIndexes.lastGameIndex].status && (cache_data.dates[0].games[gameIndexes.lastGameIndex].status.startTimeTBD == true) ) {
            compareEnd = new Date(cache_data.dates[0].games[gameIndexes.lastGameIndex-1].gameDate)
            compareEnd.setHours(compareEnd.getHours()+4)
          }
          compareEnd.setHours(compareEnd.getHours()+4)
          body += '<tr><td><span class="tooltip">' + compareStart.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }) + ' - ' + compareEnd.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }) + '<span class="tooltiptext">The game changer stream will automatically switch between the highest leverage active live non-blackout games, and should be available whenever there are such games available. Does not support adaptive bitrate switching, will default to best resolution if not specified.</span></span></td><td>'
          if ( (currentDate >= compareStart) && (currentDate < compareEnd) ) {
            let streamURL = server + '/gamechanger.m3u8'
            let multiviewquerystring = streamURL + '?resolution=' + DEFAULT_MULTIVIEW_RESOLUTION + content_protect_b
            streamURL += content_protect_a
            if ( resolution != VALID_RESOLUTIONS[0] ) streamURL += '&resolution=' + resolution
            if ( linkType != VALID_LINK_TYPES[1] ) {
              streamURL = thislink + '?src=' + encodeURIComponent(streamURL) + '&startFrom=' + VALID_START_FROM[1] + content_protect_b
            }
            body += '<a href="' + streamURL + '">Game Changer</a>'
            body += '<input type="checkbox" value="' + multiviewquerystring + '" onclick="addmultiview(this, [], excludeTeams)">'
          } else {
            body += 'Game Changer'
          }
          body += '</td></tr>' + "\n"
        }
      }
    }

    if ( cache_data.dates && cache_data.dates[0] && cache_data.dates[0].games ) {
      for (var j = 0; j < cache_data.dates[0].games.length; j++) {
        let game_started = false

        let awayteam = cache_data.dates[0].games[j].teams['away'].team.abbreviation
        let awayteam_abbr
        if ( cache_data.dates[0].games[j].teams['away'].team.sport.name != 'Major League Baseball' ) {
          awayteam = cache_data.dates[0].games[j].teams['away'].team.shortName + ' (' + session.getParent(cache_data.dates[0].games[j].teams['away'].team.parentOrgName) + ')'
          awayteam_abbr = cache_data.dates[0].games[j].teams['away'].team.abbreviation
          awayteam_level = session.getLevelNameFromSportId(cache_data.dates[0].games[j].teams['away'].team.sport.id)
        }
        let hometeam = cache_data.dates[0].games[j].teams['home'].team.abbreviation
        let hometeam_abbr
        if ( cache_data.dates[0].games[j].teams['home'].team.sport.name != 'Major League Baseball' ) {
          hometeam = cache_data.dates[0].games[j].teams['home'].team.shortName + ' (' + session.getParent(cache_data.dates[0].games[j].teams['home'].team.parentOrgName) + ')'
          hometeam_abbr = cache_data.dates[0].games[j].teams['home'].team.abbreviation
          hometeam_level = session.getLevelNameFromSportId(cache_data.dates[0].games[j].teams['home'].team.sport.id)
        }

        let teams = ""
        if ( awayteam_abbr ) {
          teams += '<span class="tooltip">' + awayteam + '<span class="tooltiptext">Team Abbreviation: ' + awayteam_abbr + ', level ' + awayteam_level + '</span></span>'
        } else {
          teams += awayteam
        }
        teams += " @ "
        if ( hometeam_abbr ) {
          teams += '<span class="tooltip">' + hometeam + '<span class="tooltiptext">Team Abbreviation: ' + hometeam_abbr + ', level ' + hometeam_level + '</span></span>'
        } else {
          teams += hometeam
        }
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

        var scheduledInnings = await session.get_scheduled_innings(cache_data.dates[0].games[j])
        var relative_inning = (inning_number - (9 - scheduledInnings))
        relative_inning = relative_inning < 0 ? 0 : relative_inning
        //if ( (scores == VALID_SCORES[1]) && (cache_data.dates[0].games[j].gameUtils.isLive || cache_data.dates[0].games[j].gameUtils.isFinal) && !cache_data.dates[0].games[j].gameUtils.isCancelled && !cache_data.dates[0].games[j].gameUtils.isPostponed ) {
        if ( (scores == VALID_SCORES[1]) && (abstractGameState != 'Preview') && (detailedState != 'Postponed') ) {
          let awayscore = ''
          let homescore = ''
          if ( (inning_number != VALID_INNING_NUMBER[0]) && cache_data.dates[0].games[j].linescore && cache_data.dates[0].games[j].linescore.innings ) {
            awayscore = 0
            homescore = 0
            let display_inning = ''
            for (var k = 0; k < cache_data.dates[0].games[j].linescore.innings.length; k++) {
              if ( cache_data.dates[0].games[j].linescore.innings[k] ) {
                if ( (cache_data.dates[0].games[j].linescore.innings[k].num < relative_inning) ) {
                  display_inning = 'T' + cache_data.dates[0].games[j].linescore.innings[k].num
                  if ( typeof cache_data.dates[0].games[j].linescore.innings[k].away.runs !== 'undefined' ) awayscore += cache_data.dates[0].games[j].linescore.innings[k].away.runs
                  if ( typeof cache_data.dates[0].games[j].linescore.innings[k].home.runs !== 'undefined' ) {
                    display_inning = 'B' + cache_data.dates[0].games[j].linescore.innings[k].num
                    homescore += cache_data.dates[0].games[j].linescore.innings[k].home.runs
                    if ( cache_data.dates[0].games[j].linescore.innings[k+1] ) {
                      display_inning = 'T' + (cache_data.dates[0].games[j].linescore.innings[k].num + 1)
                    }
                  }
                } else if ( (inning_half == VALID_INNING_HALF[2]) && (cache_data.dates[0].games[j].linescore.innings[k].num == relative_inning) ) {
                  if ( typeof cache_data.dates[0].games[j].linescore.innings[k].away.runs !== 'undefined' ) {
                    display_inning = 'B' + cache_data.dates[0].games[j].linescore.innings[k].num
                    awayscore += cache_data.dates[0].games[j].linescore.innings[k].away.runs
                  }
                } else {
                  break
                }
              } else {
                break
              }
            }
            if ( display_inning != '' ) {
              state = "<br/>" + display_inning
            }
          } else {
            awayscore = cache_data.dates[0].games[j].teams['away'].score
            homescore = cache_data.dates[0].games[j].teams['home'].score
            //if ( cache_data.dates[0].games[j].gameUtils.isLive && !cache_data.dates[0].games[j].gameUtils.isFinal ) {
            if ( abstractGameState == 'Live' ) {
              state = "<br/>" + cache_data.dates[0].games[j].linescore.inningHalf.substr(0,1) + cache_data.dates[0].games[j].linescore.currentInning
            //} else if ( cache_data.dates[0].games[j].gameUtils.isFinal ) {
            } else if ( abstractGameState == 'Final' ) {
              state = "<br/>" + detailedState
            }
            if ( cache_data.dates[0].games[j].flags ) {
              if ( cache_data.dates[0].games[j].flags.perfectGame == true ) {
                state += "<br/>Perfect Game"
              } else if ( cache_data.dates[0].games[j].flags.noHitter == true ) {
                state += "<br/>No-Hitter"
              }
            }
          }
          teams = awayteam + " " + awayscore + " @ " + hometeam + " " + homescore
        //} else if ( cache_data.dates[0].games[j].gameUtils.isCancelled || cache_data.dates[0].games[j].gameUtils.isPostponed || cache_data.dates[0].games[j].gameUtils.isSuspended ) {
        } else if ( detailedState == 'Postponed' ) {
          state = "<br/>" + detailedState
        //} else if ( cache_data.dates[0].games[j].gameUtils.isDelayed ) {
        } else if ( detailedState.startsWith('Delayed') ) {
          state += "<br/>" + detailedState
        }

        if ( cache_data.dates[0].games[j].doubleHeader != 'N'  ) {
          state += "<br/>Game " + cache_data.dates[0].games[j].gameNumber
        }
        if ( cache_data.dates[0].games[j].description ) {
          state += "<br/>" + cache_data.dates[0].games[j].description
        }
        if ( scheduledInnings != '9' ) {
          state += "<br/>" + scheduledInnings + "-inning game"
        }
        var resumeStatus = false
        if ( cache_data.dates[0].games[j].resumeGameDate || cache_data.dates[0].games[j].resumedFromDate ) {
          state += '<br/>Resum'
          let resumeDate
          if ( cache_data.dates[0].games[j].resumeGameDate ) {
            resumeDate = new Date(cache_data.dates[0].games[j].resumeDate)
            state += 'ing on'
          } else {
            resumeDate = new Date(cache_data.dates[0].games[j].resumedFrom)
            state += 'ed from'
          }
          state += '<br/>' + resumeDate.toLocaleString('default', { month: 'long', day: 'numeric' })
          // Also show the status by the media links, if one of them is live
          resumeStatus = 'archived'
          if ( ((typeof cache_data.dates[0].games[j].content.media) != 'undefined') && ((typeof cache_data.dates[0].games[j].content.media.epg) != 'undefined') ) {
            for (var k = 0; k < cache_data.dates[0].games[j].content.media.epg.length; k++) {
              if ( cache_data.dates[0].games[j].content.media.epg[k].items ) {
                for (var x = 0; x < cache_data.dates[0].games[j].content.media.epg[k].items.length; x++) {
                  if ( cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState && (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON') ) {
                    resumeStatus = 'live'
                    break
                  }
                }
                if ( resumeStatus ) break
              }
            }
          }
        }

        if ( (cache_data.dates[0].games[j].teams['away'].probablePitcher && cache_data.dates[0].games[j].teams['away'].probablePitcher.fullName) || (cache_data.dates[0].games[j].teams['home'].probablePitcher && cache_data.dates[0].games[j].teams['home'].probablePitcher.fullName) ) {
          pitchers = "<br/>"
          if ( cache_data.dates[0].games[j].teams['away'].probablePitcher && cache_data.dates[0].games[j].teams['away'].probablePitcher.fullName ) {
            if ( cache_data.dates[0].games[j].teams['away'].team.sport.name != 'Major League Baseball' ) {
              pitchers += cache_data.dates[0].games[j].teams['away'].probablePitcher.fullName
            } else {
              pitchers += getLastName(cache_data.dates[0].games[j].teams['away'].probablePitcher.fullName)
            }
            pitchers += '</a>'
          } else {
            pitchers += 'TBD'
          }
          pitchers += ' vs '
          if ( cache_data.dates[0].games[j].teams['home'].probablePitcher && cache_data.dates[0].games[j].teams['home'].probablePitcher.fullName ) {
            if ( cache_data.dates[0].games[j].teams['home'].team.sport.name != 'Major League Baseball' ) {
              pitchers += cache_data.dates[0].games[j].teams['home'].probablePitcher.fullName
            } else {
              pitchers += getLastName(cache_data.dates[0].games[j].teams['home'].probablePitcher.fullName)
            }
            pitchers += '</a>'
          } else {
            pitchers += 'TBD'
          }
        }

        body += '<tr'
        let fav_style = ''
        if ( argv.free && cache_data.dates[0].games[j].content && cache_data.dates[0].games[j].content.media && cache_data.dates[0].games[j].content.media.freeGame ) {
          body += ' class="freegame"'
        } else if ( session.credentials.fav_teams.includes(cache_data.dates[0].games[j].teams['away'].team.abbreviation) || session.credentials.fav_teams.includes(cache_data.dates[0].games[j].teams['home'].team.abbreviation) ) {
          let fav_team = cache_data.dates[0].games[j].teams['away'].team.abbreviation
          if ( session.credentials.fav_teams.includes(cache_data.dates[0].games[j].teams['home'].team.abbreviation) ) {
            fav_team = cache_data.dates[0].games[j].teams['home'].team.abbreviation
          }
          fav_style = ' style="color:#' + TEAM_COLORS[fav_team][0] + ';background:#' + TEAM_COLORS[fav_team][1] + ';"'
          body += fav_style
        }
        let description = ''
        if ( cache_data.dates[0].games[j].seriesDescription != 'Regular Season' ) {
          description += cache_data.dates[0].games[j].seriesDescription + ': '
        }
        body += '><td>' + description + teams + pitchers + state + '</td>'

        // Check if Winter League / MiLB game first
        if ( (cache_data.dates[0].games[j].teams['home'].team.sport.id != levels['MLB']) && (mediaType == 'MLBTV') ) {
          body += "<td>"
          if ( cache_data.dates[0].games[j].broadcasts ) {
            let broadcastName = 'N/A'
            for (var k = 0; k < cache_data.dates[0].games[j].broadcasts.length; k++) {
              if ( cache_data.dates[0].games[j].broadcasts[k].name != 'Audio' ) {
                broadcastName = mediaType
                break
              }
            }
            if ( broadcastName == 'N/A' ) {
              body += broadcastName
            } else {
              // Check if game should be live
              if ( (cache_data.dates[0].games[j].status.detailedState != 'Postponed') && (cache_data.dates[0].games[j].status.detailedState != 'Cancelled') ) {
                // Check if game should be live
                let currentTime = new Date()
                let startTime = new Date(cache_data.dates[0].games[j].gameDate)
                startTime.setMinutes(startTime.getMinutes()-30)
                if ( (currentTime >= startTime) ) {
                  let gamePk = cache_data.dates[0].games[j].gamePk
                  let querystring
                  querystring = '?gamePk=' + gamePk
                  let multiviewquerystring = querystring + '&resolution=' + DEFAULT_MULTIVIEW_RESOLUTION
                  if ( resolution != VALID_RESOLUTIONS[0] ) querystring += '&resolution=' + resolution
                  if ( linkType == VALID_LINK_TYPES[0] ) {
                    if ( startFrom != VALID_START_FROM[0] ) querystring += '&startFrom=' + startFrom
                    if ( controls != VALID_CONTROLS[0] ) querystring += '&controls=' + controls
                  }
                  if ( resumeStatus == false ) {
                    if ( inning_half != VALID_INNING_HALF[0] ) querystring += '&inning_half=' + inning_half
                    if ( inning_number != VALID_INNING_NUMBER[0] ) querystring += '&inning_number=' + relative_inning
                    if ( skip != VALID_SKIP[0] ) querystring += '&skip=' + skip
                    //if ( skip_adjust != DEFAULT_SKIP_ADJUST ) querystring += '&skip_adjust=' + skip_adjust
                  }
                  if ( pad != VALID_PAD[0] ) querystring += '&pad=' + pad
                  if ( linkType == VALID_LINK_TYPES[1] ) {
                    let endTime = new Date(cache_data.dates[0].games[j].gameDate)
                    endTime.setHours(endTime.getHours()+4)
                    if ( currentTime < endTime ) {
                      if ( force_vod != VALID_FORCE_VOD[0] ) querystring += '&force_vod=' + force_vod
                    }
                  }
                  querystring += content_protect_b
                  multiviewquerystring += content_protect_b
                  body += '<a href="' + thislink + querystring + '">' + broadcastName + '</a>'
                  body += '<input type="checkbox" value="' + server + '/stream.m3u8' + multiviewquerystring + '" onclick="addmultiview(this)">'
                } else {
                  body += broadcastName
                }
              }
            }
          }
          body += "</td>"
        } else {
          // Begin MLB games
          if ( ((typeof cache_data.dates[0].games[j].content.media) == 'undefined') || ((typeof cache_data.dates[0].games[j].content.media.epg) == 'undefined') ) {
            body += "<td></td>"
          } else {
            body += "<td>"
            for (var k = 0; k < cache_data.dates[0].games[j].content.media.epg.length; k++) {
              let mediaTitle = cache_data.dates[0].games[j].content.media.epg[k].title
              if ( mediaTitle == mediaType ) {
                // initial loop will count number of broadcasts
                let broadcast_count = await session.count_broadcasts(cache_data.dates[0].games[j].content.media.epg[k].items, mediaType, mediaTitle, language)

                if ( cache_data.dates[0].games[j].content.media.epg[k].items ) {
                  for (var x = 0; x < cache_data.dates[0].games[j].content.media.epg[k].items.length; x++) {
                    // for video, check that it's not in-market
                    if ( (mediaType == 'MLBTV') && await session.check_in_market(cache_data.dates[0].games[j].content.media.epg[k].items[x]) ) {
                      continue
                    }

                    // check if language is not set (video) or it matches requested language
                    if ( ((typeof cache_data.dates[0].games[j].content.media.epg[k].items[x].language) == 'undefined') || (cache_data.dates[0].games[j].content.media.epg[k].items[x].language == language) ) {
                      let teamabbr

                      if ( (((typeof cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType) != 'undefined') && (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType == 'NATIONAL')) || ((mediaType == 'MLBTV') && (cache_data.dates[0].games[j].seriesDescription != 'Regular Season') && (cache_data.dates[0].games[j].seriesDescription != 'Spring Training')) ) {
                        teamabbr = 'NATIONAL'
                      } else {
                        teamabbr = hometeam
                        if ( cache_data.dates[0].games[j].content.media.epg[k].items[x][mediaFeedType] == 'AWAY' ) {
                          teamabbr = awayteam
                        }
                      }
                      let station = cache_data.dates[0].games[j].content.media.epg[k].items[x].callLetters

                      // display blackout tooltip, if necessary
                      let gamePk = cache_data.dates[0].games[j].gamePk.toString()
                      if ( blackouts[gamePk] ) {
                        body += '<span class="tooltip"><span class="blackout">' + teamabbr + '</span><span class="tooltiptext">' + blackouts[gamePk].blackout_type + ' video blackout until approx. 2.5 hours after the game'
                        if ( blackouts[gamePk].blackoutExpiry ) {
                          body += ' (~' + blackouts[gamePk].blackoutExpiry.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }) + ')'
                        }
                        body += '</span></span>'
                      } else if ( (station == 'FOX') ) {
                        body += '<span class="tooltip">' + teamabbr + '<span class="tooltiptext">Regional FOX game</span></span>'
                      } else {
                        body += teamabbr
                      }
                      body += ': '

                      //if ( (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON') || (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ARCHIVE') || cache_data.dates[0].games[j].gameUtils.isFinal ) {
                      if ( (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON') || (cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ARCHIVE') || (abstractGameState == 'Final') ) {
                        let gameTime = new Date(cache_data.dates[0].games[j].gameDate)
                        gameTime.setMinutes(gameTime.getMinutes()-10)
                        if ( curDate >= gameTime ) {
                          game_started = true
                        }
                        let mediaId = cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaId
                        if ( (mediaType == 'MLBTV') && (gameDate == today) && session.cache.media && session.cache.media[mediaId] && session.cache.media[mediaId].blackout && session.cache.media[mediaId].blackoutExpiry && (new Date(session.cache.media[mediaId].blackoutExpiry) > new Date()) ) {
                          body += '<span class="blackout">' + station + '</span>'
                        } else {
                          let querystring
                          querystring = '?mediaId=' + mediaId

                          // grab any alternate audio tracks, if necessary
                          if ( (mediaType == 'MLBTV') && (broadcast_count == 1) ) {
                            let alternateAudioTracks = await session.getAlternateAudioTracks(cache_data.dates[0].games[j].content.media.epg, cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaFeedType)
                            for (const [key, value] of Object.entries(alternateAudioTracks)) {
                              querystring += '&' + key + '=' + value
                            }
                          }

                          let multiviewquerystring = querystring + '&resolution=' + DEFAULT_MULTIVIEW_RESOLUTION + '&audio_track=' + DEFAULT_MULTIVIEW_AUDIO_TRACK
                          if ( linkType == VALID_LINK_TYPES[0] ) {
                            if ( startFrom != VALID_START_FROM[0] ) querystring += '&startFrom=' + startFrom
                            if ( controls != VALID_CONTROLS[0] ) querystring += '&controls=' + controls
                          }
                          if ( mediaType == 'MLBTV' ) {
                            if ( inning_half != VALID_INNING_HALF[0] ) querystring += '&inning_half=' + inning_half
                            if ( inning_number != VALID_INNING_NUMBER[0] ) querystring += '&inning_number=' + relative_inning
                            if ( skip != VALID_SKIP[0] ) querystring += '&skip=' + skip
                            if ( (inning_half != VALID_INNING_HALF[0]) || (inning_number != VALID_INNING_NUMBER[0]) || (skip != VALID_SKIP[0]) ) {
                              let contentId = cache_data.dates[0].games[j].content.media.epg[k].items[x].contentId
                              querystring += '&contentId=' + contentId
                            }
                            if ( resolution != VALID_RESOLUTIONS[0] ) querystring += '&resolution=' + resolution
                            if ( audio_track != VALID_AUDIO_TRACKS[0] ) querystring += '&audio_track=' + encodeURIComponent(audio_track)
                          }
                          if ( pad != VALID_PAD[0] ) querystring += '&pad=' + pad
                          if ( linkType == VALID_LINK_TYPES[1] ) {
                            if ( cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ON' ) {
                              if ( force_vod != VALID_FORCE_VOD[0] ) querystring += '&force_vod=' + force_vod
                            }
                          }
                          querystring += content_protect_b
                          multiviewquerystring += content_protect_b
                          stationlink = '<a' + fav_style + ' href="' + thislink + querystring + '">' + station + '</a>'

                          if ( blackouts[gamePk] ) {
                            body += '<span class="blackout">' + stationlink + '</span>'
                          } else {
                            body += stationlink
                          }
                          if ( mediaType == 'MLBTV' ) {
                            body += '<input type="checkbox" value="' + server + '/stream.m3u8' + multiviewquerystring + '" onclick="addmultiview(this, [\'' + awayteam + '\', \'' + hometeam + '\'])">'
                          }
                          if ( resumeStatus ) {
                            body += '('
                            // for suspended games that haven't finished yet, we can simply use the mediaState to determine the status
                            if ( resumeStatus == 'live' ) {
                              if ( cache_data.dates[0].games[j].content.media.epg[k].items[x].mediaState == 'MEDIA_ARCHIVE' ) {
                                body += '1'
                              } else {
                                body += '2'
                              }
                            // otherwise, for completed games, we need to check the airings data
                            } else {
                              airings_data = await session.getAiringsData('', cache_data.dates[0].games[j].gamePk)
                              if ( airings_data.data && airings_data.data.Airings && (airings_data.data.Airings.length > 0) ) {
                                for (var y = 0; y < airings_data.data.Airings.length; y++) {
                                  if ( airings_data.data.Airings[y].contentId == cache_data.dates[0].games[j].content.media.epg[k].items[x].contentId ) {
                                    if ( (cache_data.dates[0].games[j].resumeDate && (cache_data.dates[0].games[j].resumeDate == airings_data.data.Airings[y].startDate)) || (cache_data.dates[0].games[j].resumedFrom && (cache_data.dates[0].games[j].gameDate == airings_data.data.Airings[y].startDate)) ) {
                                      body += '2'
                                    } else {
                                      body += '1'
                                    }
                                    break
                                  }
                                }
                              }
                            }
                            body += ')'
                          }
                        }
                      } else {
                        if ( blackouts[gamePk] ) {
                          body += '<s>' + station + '</s>'
                        } else {
                          body += station
                        }
                      }
                      body += ', '
                      // add YouTube link where available
                      if ( (mediaType == 'MLBTV') && cache_data.dates[0].games[j].content.media.epg[k].items[x].youtube && cache_data.dates[0].games[j].content.media.epg[k].items[x].youtube.videoId ) {
                        body += '<a' + fav_style + ' href="https://www.youtube.com/watch?v=' + cache_data.dates[0].games[j].content.media.epg[k].items[x].youtube.videoId + '" target="_blank">' + station + '&UpperRightArrow;</a>'
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
            //if ( (mediaType == 'MLBTV') && (game_started) && cache_data.dates[0].games[j].content && cache_data.dates[0].games[j].content.summary && cache_data.dates[0].games[j].content.summary.hasHighlightsVideo ) {
            if ( (mediaType == 'MLBTV') && (game_started) ) {
              body += '<br/><a' + fav_style + ' href="javascript:showhighlights(\'' + cache_data.dates[0].games[j].gamePk + '\',\'' + gameDate + '\')">Highlights</a>'
            }
          }
          body += "</td>"
          body += "</tr>" + "\n"
        }
      }
    }
    body += "</table>" + "\n"

    if ( (Object.keys(blackouts).length > 0) ) {
      body += '<span class="tooltip tinytext"><span class="blackout">strikethrough</span> indicates a live blackout<span class="tooltiptext">USA only. Blackout labels are purely informative and based on the USA zip code, if any, you provided when starting the server. The actual blackouts are based on your location, not on the provided zip code, so providing a different zip code will not enable you to see different games. Tap or hover over the team abbreviation to see an estimate of when the blackout will be lifted (officially ~90 minutes, but more likely ~150 minutes or ~2.5 hours after the game ends).</span></span>' + "\n"
      if ( argv.free ) {
        body += '<br/>'
      }
    }

    if ( argv.free ) {
      body += '<span class="freegame tooltip tinytext">green indicates a free game<span class="tooltiptext">Free games are available to anyone with an account, no subscription necessary. Blackouts still apply.</span></span>' + "\n"
    }

    // Rename parameter back before displaying further links
    if ( mediaType == 'MLBTV' ) {
      mediaType = VALID_MEDIA_TYPES[0]
    }

    if ( mediaType == VALID_MEDIA_TYPES[0] ) {
        body += '<p><span class="tooltip">Video<span class="tooltiptext">For video streams only: you can manually specifiy a video track (resolution) to use. Adaptive will let your client choose. 720p60 is the best quality. 540p is default for multiview (see below).<br/><br/>None will allow to remove the video tracks, if you just want to listen to the audio while using the "start at inning" or "skip breaks" options enabled.</span></span>: '
        for (var i = 0; i < VALID_RESOLUTIONS.length; i++) {
          body += '<button '
          if ( resolution == VALID_RESOLUTIONS[i] ) body += 'class="default" '
          body += 'onclick="resolution=\'' + VALID_RESOLUTIONS[i] + '\';reload()">' + VALID_RESOLUTIONS[i]
          if ( DISPLAY_BANDWIDTHS[i] != '' ) {
            body += '<br/><span class="tinytext">' + DISPLAY_BANDWIDTHS[i] + '</span>'
          }
          body += '</button> '
        }
        body += '</p>' + "\n"

        body += '<p><span class="tooltip">Audio<span class="tooltiptext">For video streams only: you can manually specifiy which audio track to include. Some media players can accept them all and let you choose. Not all tracks are available for all games, and injected tracks (away radio for national games, for example) may not work with skip options below.<br/><br/>If you select "none" for video above, picking an audio track here will make it an audio-only feed that supports the inning start and skip breaks options.</span></span>: '
        for (var i = 0; i < VALID_AUDIO_TRACKS.length; i++) {
          body += '<button '
          if ( audio_track == VALID_AUDIO_TRACKS[i] ) body += 'class="default" '
          body += 'onclick="audio_track=\'' + VALID_AUDIO_TRACKS[i] + '\';reload()">' + DISPLAY_AUDIO_TRACKS[i] + '</button> '
        }
        body += '</p>' + "\n"

        body += '<p><span class="tooltip">Skip<span class="tooltiptext">For video streams only (use the video "none" option above to apply it to audio streams): you can remove all breaks, idle time, non-action pitches, or only commercial breaks from the stream (useful to make your own "condensed games").<br/><br/>NOTE: skip timings are only generated when the stream is loaded -- so for live games, it will only skip up to the time you loaded the stream. Also, commercial break skipping will ignore inning start options (it will always start from the beginning).</span></span>: '
        for (var i = 0; i < VALID_SKIP.length; i++) {
          body += '<button '
          if ( skip == VALID_SKIP[i] ) body += 'class="default" '
          body += 'onclick="skip=\'' + VALID_SKIP[i] + '\';reload()">' + VALID_SKIP[i] + '</button> '
        }
        body += '</p>' + "\n"
      }

      body += '<p><span class="tooltip">Pad<span class="tooltiptext">You can pad archive streams with random extra time at the end, to help conceal timeline spoilers.</span></span>: '
      for (var i = 0; i < VALID_PAD.length; i++) {
        body += '<button '
        if ( pad == VALID_PAD[i] ) body += 'class="default" '
        body += 'onclick="pad=\'' + VALID_PAD[i] + '\';reload()">' + VALID_PAD[i] + '</button> '
      }
      body += '</p>' + "\n"

      if ( mediaType == VALID_MEDIA_TYPES[0] ) {
        body += '<table><tr><td><table><tr><td>1</td><td>2</tr><tr><td>3</td><td>4</td></tr></table><td><span class="tooltip">Multiview / Alternate Audio / Sync<span class="tooltiptext">For video streams only: create a new live stream combining 1-4 separate video streams, using the layout shown at left (if more than 1 video stream is selected). Check the boxes next to feeds above to add/remove them, then click "Start" when ready, "Stop" when done watching, or "Restart" to stop and start with the currently selected streams. May take up to 15 seconds after starting before it is ready to play.<br/><br/>No video scaling is performed: defaults to 540p video for each stream, which can combine to make one 1080p stream. Audio defaults to English (TV) audio. If you specify a different audio track instead, you can use the box after each URL below to adjust the sync in seconds (use positive values if audio is early and the audio stream needs to be padded with silence at the beginning to line up with the video; negative values if audio is late, and audio needs to be trimmed from the beginning.)<br/><br/>TIP #1: You can enter just 1 video stream here, at any resolution, to take advantage of the audio sync or alternate audio features without using multiview -- a single video stream will not be re-encoded and will be presented at its full resolution.<br/><br/>TIP #2: You can also manually enter streams from other sources like <a href="https://www.npmjs.com/package/milbserver" target="_blank">milbserver</a> in the boxes below. Make sure any manually entered streams have the desired resolution.<br/><br/>WARNING #1: if the mlbserver process dies or restarts while multiview is active, the ffmpeg encoding process will be orphaned and must be killed manually.<br/><br/>WARNING #2: If you did not specify a hardware encoder for ffmpeg on the command line, this will use your server CPU for encoding. Either way, your system may not be able to keep up with processing 4 video streams at once. Try fewer streams if you have perisistent trouble.</span></span>: <a id="startmultiview" href="" onclick="startmultiview(this);return false">Start'
        if ( ffmpeg_status ) body += 'ed'
        body += '</a> | <a id="stopmultiview" href="" onclick="stopmultiview(this);return false">Stop'
        if ( !ffmpeg_status ) body += 'ped'
        body += '</a><br/>' + "\n"
        body += '<span class="tinytext">(check boxes next to games to add, then click "Start";<br/>must click "Stop" link above when done, or manually kill ffmpeg)</span></td></tr><tr><td colspan="2">' + "\n"
        for (var i=1; i<=4; i++) {
          body += i + ': <textarea id="multiview' + i + '" rows=2 cols=60 oninput="this.value=stream_substitution(this.value)"></textarea>'
          body += '<input type="number" id="sync' + i + '" value="0.0" step=".1" style="vertical-align:top;font-size:.8em;width:3em"/>'
          body += '<br/>' + "\n"
        }
        body += '<input type="checkbox" id="dvr"/> <span class="tooltip">DVR: allow pausing/seeking multiview<span class="tooltiptext">If this is enabled, it will use more disk space but you will be able to pause and seek in the multiview stream. Not necessary if you are strictly watching live.</span></span><br/>' + "\n"
        body += '<input type="checkbox" id="faster" onchange="if (this.checked){document.getElementById(\'dvr\').checked=true}"/> <span class="tooltip">Encode faster than real-time<span class="tooltiptext">Implies DVR. Not necessary for live streams (which are only delivered in real-time), but if you want to seek ahead in archive streams using multiview, you may want to enable this. WARNING: ffmpeg may approach 100% CPU usage if you use this while combining multiple archive video streams in multiview.</span></span><br/>' + "\n"
        body += '<input type="checkbox" id="reencode"/> <span class="tooltip">Re-encode all audio<span class="tooltiptext">Uses more CPU. Generally only necessary if you need the multiview stream to continue after one of the individual streams has ended. (Any streams with sync adjustments above will automatically be re-encoded, regardless of this setting.)</span></span><br/>' + "\n"
        body += '<input type="checkbox" id="park_audio"/> <span class="tooltip">Park audio: filter out announcers<span class="tooltiptext">Implies re-encoding all audio. If this is enabled, an extra audio filter is applied to remove the announcer voices.</span></span><br/>' + "\n"
        body += '<hr><span class="tooltip">Alternate audio URL and sync<span class="tooltiptext">Optional: you can also include a separate audio-only URL as an additional alternate audio track. Archive games will likely require a very large negative sync value, as the radio broadcasts may not be trimmed like the video archives.</span></span>:<br/><textarea id="audio_url" rows=2 cols=60 oninput="this.value=stream_substitution(this.value)"></textarea><input id="audio_url_seek" type="number" value="0" style="vertical-align:top;font-size:.8em;width:4em"/>'
        body += '<hr>Watch: <a href="/embed.html?src=' + encodeURIComponent(multiview_server + multiview_url_path) + '">Embed</a> | <a href="' + multiview_server + multiview_url_path + '">Stream</a> | <a href="/chromecast.html?src=' + encodeURIComponent(multiview_server + multiview_url_path) + '">Chromecast</a> | <a href="/advanced.html?src=' + encodeURIComponent(multiview_server + multiview_url_path) + '">Advanced</a><br/><span class="tinytext">Download: <a href="/kodi.strm?src=' + encodeURIComponent(multiview_server + multiview_url_path) + '">Kodi STRM file</a> (<a href="/kodi.strm?version=18&src=' + encodeURIComponent(multiview_server + multiview_url_path) + '">Leia/18</a>)</span>'
        body += '</td></tr></table><br/>' + "\n"
    }

    if ( (linkType == VALID_LINK_TYPES[1]) && (gameDate == today) ) {
      body += '<p><span class="tooltip">Force VOD<span class="tooltiptext">For streams only: if your client does not support seeking in mlbserver live streams, turning this on will make the stream look like a VOD stream instead, allowing the client to start at the beginning and allowing the user to seek within it. You will need to reload the stream to watch/view past the current time, though.</span></span>: '
      for (var i = 0; i < VALID_FORCE_VOD.length; i++) {
        body += '<button '
        if ( force_vod == VALID_FORCE_VOD[i] ) body += 'class="default" '
        body += 'onclick="force_vod=\'' + VALID_FORCE_VOD[i] + '\';reload()">' + VALID_FORCE_VOD[i] + '</button> '
      }
      body += '<span class="tinytext">(if client does not support seeking in live streams)</span></p>' + "\n"
    }

    body += '<table><tr><td>' + "\n"

    body += '<p><span class="tooltip">Live Channel Playlist and XMLTV Guide<span class="tooltiptext">Allows you to generate a M3U playlist of channels, and an XML file of guide listings for those channels, to import into TV/DVR/PVR software like Tvheadend or Jellyfin.<br/><br/>NOTE: May be helpful to specify a resolution above.</span></span>:</p>' + "\n"

    body += '<p><span class="tooltip">Scan Mode<span class="tooltiptext">During setup, some TV/DVR/PVR software will attempt to load all stream URLs. Turning Scan Mode ON will return a sample stream for all stream requests, thus satisfying that software without overloading mlbserver or excluding streams which aren\'t currently live. Once the channels are set up, turning Scan Mode OFF will restore normal stream behavior.<br/><br/>WARNING: Be sure your TV/DVR/PVR software doesn\'t periodically scan all channels automatically or you might overload mlbserver.</span></span>: '
    for (var i = 0; i < VALID_SCAN_MODES.length; i++) {
      body += '<button '
      if ( scan_mode == VALID_SCAN_MODES[i] ) body += 'class="default" '
      body += 'onclick="scan_mode=\'' + VALID_SCAN_MODES[i] + '\';reload()">' + VALID_SCAN_MODES[i] + '</button> '
    }
    body += ' <span class="tinytext">(ON plays sample for all stream requests)</span></p>' + "\n"

    if ( !req.query.resolution ) {
      resolution = 'best'
    }

    body += '<p><span class="tooltip">All<span class="tooltiptext">Will include all live MLB broadcasts. If favorite team(s) have been provided, it will also include affiliate games for those organizations. If a zip code has been provided, channels/games subject to blackout will be omitted by default. See below for an additional option to override that.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + content_protect_b + '">guide.xml</a></p>' + "\n"

    let include_teams = 'ari,national'
    if ( session.credentials.fav_teams.length > 0 ) {
      include_teams = session.credentials.fav_teams.toString()
    }
    body += '<p><span class="tooltip">By team<span class="tooltiptext">Including a team (MLB only, by abbreviation, in a comma-separated list if more than 1) will include all of its broadcasts, or if that team is not broadcasting the game, it will include the national broadcast or opponent\'s broadcast if available. It will also include affiliate games for those organizations. If a zip code has been provided, channels/games subject to blackout will be omitted by default. See below for an additional option to override that.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&includeTeams=' + include_teams + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeTeams=' + include_teams + content_protect_b + '">guide.xml</a></p>' + "\n"

    body += '<p><span class="tooltip">Include blackouts<span class="tooltiptext">An optional parameter added to the URL will include channels/games subject to blackout (although you may not be able to play those games).</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&includeTeams=' + include_teams + '&includeBlackouts=true' + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeTeams=' + include_teams + '&includeBlackouts=true' + content_protect_b + '">guide.xml</a></p>' + "\n"

    let exclude_teams = 'ari,national'
    if ( session.credentials.blackout_teams.length > 0 ) {
      exclude_teams = session.credentials.blackout_teams.toString()
      exclude_teams += ',national'
    }
    body += '<p><span class="tooltip">Exclude a team + national<span class="tooltiptext">This is useful for excluding games you may be blacked out from, even if you have not provided a zip code. Excluding a team (MLB only, by abbreviation, in a comma-separated list if more than 1) will exclude every game involving that team. National refers to <a href="https://www.mlb.com/live-stream-games/national-blackout">USA national TV broadcasts</a>.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&excludeTeams=' + exclude_teams + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&excludeTeams=' + exclude_teams + content_protect_b + '">guide.xml</a></p>' + "\n"

    body += '<p><span class="tooltip">Include (or exclude) LIDOM<span class="tooltiptext">Dominican Winter League, aka Liga de Beisbol Dominicano. Live stream only, does not support starting from the beginning or certain innings, skip options, etc.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&includeTeams=lidom' + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeTeams=lidom' + content_protect_b + '">guide.xml</a></p>' + "\n"

    body += '<p><span class="tooltip">Include (or exclude) Big Inning<span class="tooltiptext">Big Inning is the live look-in and highlights show. <a href="https://www.mlb.com/live-stream-games/big-inning">See here for more information</a>.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&includeTeams=biginning' + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeTeams=biginning' + content_protect_b + '">guide.xml</a></p>' + "\n"

    let gamechanger_resolution = resolution
    if ( gamechanger_resolution == VALID_RESOLUTIONS[0] ) {
      gamechanger_resolution = 'best'
    }
    body += '<p><span class="tooltip">Include (or exclude) Game Changer<span class="tooltiptext">The game changer stream will automatically switch between the highest leverage active live non-blackout games, and should be available whenever there are such games available. Does not support adaptive bitrate switching, will default to best resolution if not specified.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + gamechanger_resolution + '&includeTeams=gamechanger' + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeTeams=gamechanger' + content_protect_b + '">guide.xml</a></p>' + "\n"

    body += '<p><span class="tooltip">Include (or exclude) Multiview<span class="tooltiptext">Requires starting and stopping the multiview stream from the web interface.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&includeTeams=multiview' + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeTeams=multiview' + content_protect_b + '">guide.xml</a></p>' + "\n"

    if ( argv.free ) {
      body += '<p><span class="tooltip">Free games only<span class="tooltiptext">Only includes games marked as free. Blackouts still apply. If a zip code has been provided, channels/games subject to blackout will be omitted by default.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&includeTeams=free' + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeTeams=free' + content_protect_b + '">guide.xml</a></p>' + "\n"
    }

    body += '<p><span class="tooltip">Include affiliates by org<span class="tooltiptext">Including an organization (by MLB team abbreviation, in a comma-separated list if more than 1) will include all of its affiliate broadcasts, or if that affiliate is not broadcasting the game, it will include the opponent\'s broadcast if available. If this option is not specified, but favorite team(s) have been provided, affiliate games for those organizations will be included anyway.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&includeOrgs=ari,atl' + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeOrgs=ari,atl' + content_protect_b + '">guide.xml</a></p>' + "\n"

    body += '<p><span class="tooltip">Include by level<span class="tooltiptext">Including a level (AAA, AA, A+, or A, in a comma-separated list if more than 1) will include all of its broadcasts, and exclude all other levels.</span></span>: <a href="/channels.m3u?mediaType=' + mediaType + '&resolution=' + resolution + '&includeLevels=aaa,aa' + content_protect_b + '">channels.m3u</a> and <a href="/guide.xml?mediaType=' + mediaType + '&includeLevels=aaa,aa' + content_protect_b + '">guide.xml</a></p>' + "\n"

    body += '</td></tr></table><br/>' + "\n"

    body += '<table><tr><td>' + "\n"
    body += '<p><span class="tooltip">Example links<span class="tooltiptext">Some examples how to generate predictable links.</span></span>:</p>' + "\n"
    body += '<p>' + "\n"
    let example_types = [ ['embed.html', 'Embed'], ['stream.m3u8', 'Stream'], ['chromecast.html', 'Chromecast'], ['kodi.strm', 'Kodi'] ]

    let example_team = 'ari'
    if ( session.credentials.fav_teams.length > 0 ) {
      example_team = session.credentials.fav_teams[0]
    }

    let examples = [
      ['Team live video', '?team=' + example_team + '&resolution=best'],
      ['MiLB team live video', '?team=COL&level=AAA&resolution=best'],
      ['Team live radio', '?team=' + example_team + '&mediaType=Audio'],
      ['Catch-up/condensed', '?team=' + example_team + '&resolution=best&skip=pitches&date=today'],
      ['Condensed yesterday', '?team=' + example_team + '&resolution=best&skip=pitches&date=yesterday'],
      ['Same but DH game 2', '?team=' + example_team + '&resolution=best&skip=pitches&date=yesterday&game=2'],
      ['Nat\'l game 1 today', '?team=NATIONAL.1&resolution=best&date=today'],
      ['Same but incl. blackouts', '?team=NATIONAL.1&resolution=best&includeBlackouts=true'],
      ['Nat\'l game 2 yesterday', '?team=NATIONAL.2&resolution=best&date=yesterday']
    ]

    if ( argv.free ) {
      examples = examples.concat([
        ['Free game 1 today', '?team=FREE.1&resolution=best&date=today'],
        ['Same but incl. blackouts', '?team=FREE.1&resolution=best&includeBlackouts=true'],
        ['Free game 2 yesterday', '?team=FREE.2&resolution=best&date=yesterday']
      ])
    }

    for (var i=0; i<examples.length; i++) {
      body += '&bull; ' + examples[i][0] + ': '
      for (var j=0; j<example_types.length; j++) {
        body += '<a href="/' + example_types[j][0] + examples[i][1]
        body += content_protect_b
        body += '">' + example_types[j][1] + '</a>'
        if ( j < (example_types.length-1) ) {
          body += ' | '
        } else {
          body += '<br/>' + "\n"
        }
      }
    }
    body += '</p>' + "\n"

    body += '<p><span class="tooltip">Game Changer by team examples<span class="tooltiptext">Game Changer supports specifying certain teams to include or exclude. Useful for following a group of teams.</span></span>:</p>' + "\n"
    body += '<p>' + "\n"
    let gamechanger_streamURL = server + '/gamechanger.m3u8?resolution=best' + content_protect_b
    let gamechanger_types = ['in', 'ex']
    for (var i=0; i<gamechanger_types.length; i++) {
      let example_streamURL = gamechanger_streamURL + '&' + gamechanger_types[i] + 'cludeTeams=ARI,ATL'
      body += '&bull; ' + gamechanger_types[i] + 'clude: <a href="/embed.html?src=' + encodeURIComponent(example_streamURL) + '&startFrom=' + VALID_START_FROM[1] + content_protect_b + '">Embed</a> | <a href="' + example_streamURL + '">Stream</a> | <a href="/chromecast.html?src=' + encodeURIComponent(example_streamURL) + content_protect_b + '">Chromecast</a> | <a href="/advanced.html?src=' + encodeURIComponent(example_streamURL) + content_protect_b + '">Advanced</a> | <a href="/kodi.strm?src=' + encodeURIComponent(example_streamURL) + content_protect_b + '">Kodi</a><br/>' + "\n"
    }

    body += '</p></td></tr></table><br/>' + "\n"

    let local_url = '' // default to embedded player
    let urlArray = req.url.split('?')
    if ( (urlArray.length == 2) ) {
      local_url += '?' + urlArray[1]
    }
    let media_center_link = '/live-stream-games/' + gameDate.replace(/-/g,'/') + local_url
    body += '<p><span class="tooltip">Media Center View<span class="tooltiptext">Allows you to use the MLB Media Center page format for nagivation.</span></span>: <a href="' + media_center_link + '" target="_blank">Link</a></p>' + "\n"

    body += '<p><span class="tooltip">Sample video<span class="tooltiptext">A sample stream. Useful for testing and troubleshooting.</span></span>: <a href="/embed.html' + content_protect_a + '">Embed</a> | <a href="/stream.m3u8' + content_protect_a + '">Stream</a> | <a href="/chromecast.html' + content_protect_a + '">Chromecast</a> | <a href="/advanced.html' + content_protect_a + '">Advanced</a></p>' + "\n"

    body += '<p><span class="tooltip">Bookmarklets for MLB.com<span class="tooltiptext">If you watch at MLB.com, drag these bookmarklets to your bookmarks toolbar and use them to hide parts of the interface.</span></span>: <a href="javascript:(function(){let x=document.querySelector(\'#mlbtv-stats-panel\');if(x.style.display==\'none\'){x.style.display=\'initial\';}else{x.style.display=\'none\';}})();">Boxscore</a> | <a href="javascript:(function(){let x=document.querySelector(\'.mlbtv-header-container\');if(x.style.display==\'none\'){let y=document.querySelector(\'.mlbtv-players-container\');y.style.display=\'none\';x.style.display=\'initial\';setTimeout(function(){y.style.display=\'initial\';},15);}else{x.style.display=\'none\';}})();">Scoreboard</a> | <a href="javascript:(function(){let x=document.querySelector(\'.mlbtv-container--footer\');if(x.style.display==\'none\'){let y=document.querySelector(\'.mlbtv-players-container\');y.style.display=\'none\';x.style.display=\'initial\';setTimeout(function(){y.style.display=\'initial\';},15);}else{x.style.display=\'none\';}})();">Linescore</a> | <a href="javascript:(function(){let x=document.querySelector(\'#mlbtv-stats-panel\');if(x.style.display==\'none\'){x.style.display=\'initial\';}else{x.style.display=\'none\';}x=document.querySelector(\'.mlbtv-header-container\');if(x.style.display==\'none\'){x.style.display=\'initial\';}else{x.style.display=\'none\';}x=document.querySelector(\'.mlbtv-container--footer\');if(x.style.display==\'none\'){let y=document.querySelector(\'.mlbtv-players-container\');y.style.display=\'none\';x.style.display=\'initial\';setTimeout(function(){y.style.display=\'initial\';},15);}else{x.style.display=\'none\';}})();">All</a></p>' + "\n"

    // Print version
    body += '<p class="tinytext">Version ' + version + ' (<a href="/clearcache">clear cache</a>)</p>' + "\n"

    // Datepicker functions
    body += '<script>var datePicker=document.getElementById("gameDate");function changeDate(e){date=datePicker.value;reload()}function removeDate(e){datePicker.removeEventListener("change",changeDate,false);datePicker.addEventListener("blur",changeDate,false);if(e.keyCode===13){date=datePicker.value;reload()}}datePicker.addEventListener("change",changeDate,false);datePicker.addEventListener("keypress",removeDate,false)</script>' + "\n"

    // Highlights modal defintion
    body += '<div id="myModal" class="modal"><div class="modal-content"><span class="close">&times;</span><div id="highlights"></div></div></div>'

    // Highlights modal functions
    body += '<script type="text/javascript">var modal = document.getElementById("myModal");var highlightsModal = document.getElementById("highlights");var span = document.getElementsByClassName("close")[0];function parsehighlightsresponse(responsetext) { try { var highlights = JSON.parse(responsetext);var modaltext = "<ul>"; if (highlights && highlights[0]) { for (var i = 0; i < highlights.length; i++) { modaltext += "<li><a href=\'' + link + '?highlight_src=" + encodeURIComponent(highlights[i].playbacks[3].url) + "&resolution=" + resolution + "' + content_protect_b + '\'>" + highlights[i].headline + "</a><span class=\'tinytext\'> (<a href=\'" + highlights[i].playbacks[0].url + "\'>MP4</a>)</span></li>" } } else { modaltext += "No highlights available for this game.";}modaltext += "</ul>";highlightsModal.innerHTML = modaltext;modal.style.display = "block"} catch (e) { alert("Error processing highlights: " + e.message)}} function showhighlights(gamePk, gameDate) { makeGETRequest("/highlights?gamePk=" + gamePk + "&gameDate=" + gameDate, parsehighlightsresponse);return false} span.onclick = function() {modal.style.display = "none";}' + "\n"
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
  session.requestlog('options', req, true)
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
  if ( ! (await protect(req, res)) ) return

  session.requestlog('live-stream-games', req)

  // check for a linkType parameter in the url
  let linkType = VALID_LINK_TYPES[0]
  if ( req.query.linkType ) {
    linkType = req.query.linkType
    session.setLinkType(linkType)
  }

  // use the link type to determine the local url to use
  var local_url = '/embed.html' // default to embedded player
  if ( linkType == VALID_LINK_TYPES[1] ) { // direct stream
    local_url = '/stream.m3u8'
  } else { // other
    local_url = '/' + linkType + '.html'
  }
  let urlArray = req.url.split('?')
  if ( (urlArray.length == 2) ) {
    local_url += '?' + urlArray[1]
  }

  // remove our local parameters, if specified, from the url we will fetch remotely
  var remote_url = url.parse(req.url).pathname

  let reqObj = {
    url: 'https://www.mlb.com' + remote_url,
    headers: {
      'User-Agent': session.getUserAgent(),
      'Origin': 'https://www.mlb.com',
      'Accept-Encoding': 'gzip, deflate, br'
    },
    gzip: true
  }

  var body = await session.httpGet(reqObj)

  // a regex substitution to change existing links to local urls
  body = body.replace(/https:\/\/www.mlb.com\/tv\/g(\d+)\/[v]([a-zA-Z0-9-]+)/g,local_url+"&gamePk=$1&contentId=$2")

  // a regex substitution to remove unsupported filter menus
  if ( session.protection.content_protect ) {
    body = body.replace(/<div\n            id="date-container"[\S\s]+><\/span>\n        <\/div>/g,'')
  }

  // hide popup to accept cookies
  body = body.replace(/www.googletagmanager.com/g,'0.0.0.0')

  res.end(body)
})

// Listen for embed request, respond with embedded hls.js player
app.get('/embed.html', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  session.requestlog('embed.html', req)

  let startFrom = VALID_START_FROM[0]
  if ( req.query.startFrom ) {
    startFrom = req.query.startFrom
  }
  let controls = VALID_CONTROLS[0]
  if ( req.query.controls ) {
    controls = req.query.controls
  }

  let video_url = '/stream.m3u8'
  if ( req.query.src ) {
    video_url = req.query.src
  } else {
    let urlArray = req.url.split('?')
    if ( (urlArray.length == 2) ) {
      video_url += '?' + urlArray[1]
    }
  }
  session.debuglog('embed src : ' + video_url)

  let content_protect = ''
  if ( session.protection.content_protect ) {
    content_protect = '?content_protect=' + session.protection.content_protect
  }

  // Adapted from https://hls-js.netlify.app/demo/basic-usage.html and https://hls-js-dev.netlify.app/demo
  var body = '<html><head><meta charset="UTF-8"><meta http-equiv="Content-type" content="text/html;charset=UTF-8"><title>' + appname + ' player</title><link rel="icon" href="favicon.svg"><style type="text/css">input[type=text],input[type=button]{-webkit-appearance:none;-webkit-border-radius:0}body{background-color:black;color:lightgrey;font-family:Arial,Helvetica,sans-serif}video{width:100% !important;height:auto !important;max-width:1280px}input[type=number]::-webkit-inner-spin-button{opacity:1}button{color:lightgray;background-color:black}button.default{color:black;background-color:lightgray}</style><script>function goBack(){var prevPage=window.location.href;window.history.go(-1);setTimeout(function(){if(window.location.href==prevPage){window.location.href="/' + content_protect + '"}}, 500)}function toggleAudio(x){var elements=document.getElementsByClassName("audioButton");for(var i=0;i<elements.length;i++){elements[i].className="audioButton"}document.getElementById("audioButton"+x).className+=" default";hls.audioTrack=x}function changeTime(x){video.currentTime+=x}function changeRate(x){let newRate=Math.round((Number(document.getElementById("playback_rate").value)+x)*10)/10;if((newRate<=document.getElementById("playback_rate").max) && (newRate>=document.getElementById("playback_rate").min)){document.getElementById("playback_rate").value=newRate.toFixed(1);video.defaultPlaybackRate=video.playbackRate=document.getElementById("playback_rate").value}}function myKeyPress(e){if(e.key=="ArrowRight"){changeTime(10)}else if(e.key=="ArrowLeft"){changeTime(-10)}else if(e.key=="ArrowUp"){changeRate(0.1)}else if(e.key=="ArrowDown"){changeRate(-0.1)}}</script></head><body onkeydown="myKeyPress(event)"><script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script><video id="video"'
  if ( controls == VALID_CONTROLS[0] ) {
    body += ' controls'
  }
  body += '></video><script>var video=document.getElementById("video");if(Hls.isSupported()){var hls=new Hls('

  if ( startFrom != VALID_START_FROM[1] ) {
    body += '{startPosition:0,liveSyncDuration:32400,liveMaxLatencyDuration:32410}'
  }

  body += ');hls.loadSource("' + video_url + '");hls.attachMedia(video);hls.on(Hls.Events.MEDIA_ATTACHED,function(){video.muted=true;video.play()});hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function(){var audioSpan=document.getElementById("audioSpan");var audioButtons="";for(var i=0;i<hls.audioTracks.length;i++){audioButtons+=\'<button id="audioButton\'+i+\'" class="audioButton\';if(i==0){audioButtons+=\' default\'}audioButtons+=\'" onclick="toggleAudio(\'+i+\')">\'+hls.audioTracks[i]["name"]+"</button> "}audioSpan.innerHTML=audioButtons})}else if(video.canPlayType("application/vnd.apple.mpegurl")){video.src="' + video_url + '";video.addEventListener("canplay",function(){video.play()})}</script><p>Skip: <button onclick="changeTime(-30)">- 30 s</button> <button onclick="changeTime(-10)">- 10 s</button> <button onclick="changeTime(10)">+ 10 s</button> <button onclick="changeTime(30)">+ 30 s</button> <button onclick="changeTime(90)">+ 90 s</button>  <button onclick="changeTime(120)">+ 120 s</button> '

  body += '<button onclick="changeTime(video.duration-10)">Latest</button> '

  body += '<button id="airplay">AirPlay</button></p><p>Playback rate: <input type="number" value=1.0 min=0.1 max=16.0 step=0.1 id="playback_rate" size="8" style="width: 4em" onchange="video.defaultPlaybackRate=video.playbackRate=this.value"></p><p>Audio: <button onclick="video.muted=!video.muted">Toggle Mute</button> <span id="audioSpan"></span></p><p>Controls: <button onclick="video.controls=!video.controls">Toggle Controls</button></p><p><button id="pauseButton">Pause</button></p><script>document.addEventListener("DOMContentLoaded", function() {var pauseButton = document.getElementById("pauseButton"); pauseButton.addEventListener("click", function() {if (video.paused) {video.play();} else {video.pause();}}); });</script><p><button onclick="goBack()">Back</button></p><script>var airPlay=document.getElementById("airplay");if(window.WebKitPlaybackTargetAvailabilityEvent){video.addEventListener("webkitplaybacktargetavailabilitychanged",function(event){switch(event.availability){case "available":airPlay.style.display="inline";break;default:airPlay.style.display="none"}airPlay.addEventListener("click",function(){video.webkitShowPlaybackTargetPicker()})})}else{airPlay.style.display="none"}</script></body></html>'
  res.end(body)
})

// Listen for advanced embed request, redirect to online demo hls.js player
app.get('/advanced.html', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  session.requestlog('advanced.html', req)

  let server = 'http://' + req.headers.host

  let video_url = '/stream.m3u8'
  if ( req.query.src ) {
    video_url = req.query.src
  } else {
    let urlArray = req.url.split('?')
    if ( (urlArray.length == 2) ) {
      video_url += '?' + urlArray[1]
    }
    video_url = server + video_url
  }
  session.debuglog('advanced embed src : ' + video_url)

  res.redirect('http://hls-js-dev.netlify.app/demo/?src=' + encodeURIComponent(video_url))
})

// Listen for Chromecast request, redirect to chromecast.link player
app.get('/chromecast.html', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  session.requestlog('chromecast.html', req)

  let server = 'http://' + req.headers.host

  let video_url = '/stream.m3u8'
  if ( req.query.src ) {
    video_url = req.query.src
  } else {
    let urlArray = req.url.split('?')
    if ( (urlArray.length == 2) ) {
      video_url += '?' + urlArray[1]
    }
    video_url = server + video_url
  }
  session.debuglog('chromecast src : ' + video_url)

  res.redirect('https://chromecast.link#title=' + appname + '&content=' + encodeURIComponent(video_url))
})

// Listen for channels.m3u playlist request
app.get('/channels.m3u', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  session.requestlog('channels.m3u', req)

  let mediaType = VALID_MEDIA_TYPES[0]
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

  let server = 'http://' + req.headers.host

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

  let includeBlackouts = 'false'
  if ( req.query.includeBlackouts ) {
    includeBlackouts = req.query.includeBlackouts
  }

  let includeLevels = []
  if ( req.query.includeLevels ) {
    includeLevels = decodeURIComponent(req.query.includeLevels.toUpperCase()).split(',')
  }

  let includeOrgs = []
  if ( req.query.includeOrgs ) {
    includeOrgs = req.query.includeOrgs.toUpperCase().split(',')
  }

  var body = await session.getTVData('channels', mediaType, includeTeams, excludeTeams, includeLevels, includeOrgs, server, includeBlackouts, resolution, pipe, startingChannelNumber)

  res.writeHead(200, {'Content-Type': 'audio/x-mpegurl'})
  res.end(body)
})

// Listen for guide.xml request
app.get('/guide.xml', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  session.requestlog('guide.xml', req)

  let mediaType = VALID_MEDIA_TYPES[0]
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

  let includeBlackouts = 'false'
  if ( req.query.includeBlackouts ) {
    includeBlackouts = req.query.includeBlackouts
  }

  let includeLevels = []
  if ( req.query.includeLevels ) {
    includeLevels = decodeURIComponent(req.query.includeLevels.toUpperCase()).split(',')
  }

  let includeOrgs = []
  if ( req.query.includeOrgs ) {
    includeOrgs = req.query.includeOrgs.toUpperCase().split(',')
  }

  let server = 'http://' + req.headers.host

  var body = await session.getTVData('guide', mediaType, includeTeams, excludeTeams, includeLevels, includeOrgs, server, includeBlackouts)

  res.end(body)
})

// Listen for image requests
app.get('/image.svg', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  session.requestlog('image.svg', req, true)

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
  if ( ! (await protect(req, res)) ) return

  session.requestlog('favicon.svg', req, true)

  var body = await session.getImage('MLB')

  res.writeHead(200, {'Content-Type': 'image/svg+xml'})
  res.end(body)
})

// Listen for highlights requests
app.get('/highlights', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  try {
    session.requestlog('highlights', req)

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
  if ( ! (await protect(req, res)) ) return

  try {
    session.requestlog('multiview', req)

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
      let faster = false
      if ( req.query.faster ) {
        faster = req.query.faster
        dvr = true
      }
      let reencode = false
      if ( req.query.reencode ) {
        reencode = req.query.reencode
      }
      let park_audio = false
      if ( req.query.park_audio ) {
        reencode = true
        park_audio = req.query.park_audio
      }
      let audio_url = false
      if ( req.query.audio_url && (req.query.audio_url != '') ) {
        audio_url = req.query.audio_url
      }
      let audio_url_seek = false
      if ( req.query.audio_url_seek && (req.query.audio_url_seek != '0') ) {
        audio_url_seek = req.query.audio_url_seek
      }
      // Wait to restart it
      setTimeout(function() {
        res.end(start_multiview_stream(req.query.streams, sync, dvr, faster, reencode, park_audio, audio_url, audio_url_seek))
      }, 5000)
    } else {
      res.end('stopped')
    }
  } catch (e) {
    session.log('multiview request error : ' + e.message)
    res.end('multiview request error, check log')
  }
})

function start_multiview_stream(streams, sync, dvr, faster, reencode, park_audio, audio_url, audio_url_seek) {
  try {
    ffmpeg_command = ffmpeg({ timeout: 432000 })

    // If it's not already an array (only 1 parameter was passed in URL), convert it
    if ( !Array.isArray(streams) ) streams = [streams]
    if ( !Array.isArray(sync) ) sync = [sync]

    // Max 4 streams
    var stream_count = Math.min(streams.length, 4)

    var audio_present = []
    var complexFilter = []
    var xstack_inputs = []
    var xstack_layout = '0_0|w0_0'
    var map_audio = ''

    // Video
    let video_output = '0'
    for (var i=0; i<stream_count; i++) {
      let video_url = streams[i]

      // Stream URL for testing
      //video_url = SAMPLE_STREAM_URL

      // Set input stream and its thread queue size
      ffmpeg_command.input(video_url)
      .addInputOption('-thread_queue_size', '4096')

      // We'll limit our encoding to real-time as long as the "faster" box wasn't checked
      if ( !faster ) ffmpeg_command.native()

      // Only apply filters if more than 1 stream
      if ( stream_count > 1 ) {
        complexFilter.push({
          filter: 'setpts=PTS-STARTPTS',
          inputs: i+':v:0',
          outputs: 'v'+i
        })
        xstack_inputs.push('v'+i)
      }

      // Check if audio is present
      if ( video_url.indexOf('audio_track=none') === -1 ) {
        audio_present.push(i)
      }
    }

    // Alternate audio track, if provided
    if ( audio_url ) {
      ffmpeg_command.input(audio_url)
      .addInputOption('-thread_queue_size', '4096')

      if ( !faster ) ffmpeg_command.native()

      audio_present.push(stream_count)
      if ( audio_url_seek && (audio_url_seek != 0) ) {

        if ( audio_url_seek > 0 ) {
          sync.push(audio_url_seek)
        } else if ( audio_url_seek < 0 ) {
          session.log('trimming audio for stream ' + stream_count + ' by ' + audio_url_seek + ' seconds')
          ffmpeg_command.addInputOption('-ss', (audio_url_seek * -1))
        }
      }
    }

    // More video
    // Only apply filters if more than 1 stream
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

    // Audio
    // Since audio filters require re-encoding, only apply them if sync value is specified or if "re-encode" box is checked
    // Filters: resampling preserve timestamps and padding allows the multiview stream to continue if one stream ends
    audio_reencoded = []
    for (var i=0; i<audio_present.length; i++) {
      //let audio_input = audio_present[i] + ':a:m:language:en?'
      let audio_input = audio_present[i] + ':a:0'
      let filter = ''
      // Optionally apply sync adjustments
      if ( sync[audio_present[i]] ) {
        if ( sync[audio_present[i]] > 0 ) {
          session.log('delaying audio for stream ' + (audio_present[i]+1) + ' by ' + sync[audio_present[i]] + ' seconds')
          filter = 'adelay=' + (sync[i] * 1000) + ','
        } else if ( sync[audio_present[i]] < 0 ) {
          session.log('trimming audio for stream ' + (audio_present[i]+1) + ' by ' + sync[audio_present[i]] + ' seconds')
          filter = 'atrim=start=' + (sync[audio_present[i]] * -1) + 's,'
        }
      }
      // Optionally filter to park audio
      if ( park_audio ) {
        filter = 'pan=stereo|c0=c0|c1=-1*c1,'
      }
      if ( reencode || (filter != '') ) {
        audio_reencoded.push(audio_present[i])
        complexFilter.push({
          filter: 'aresample=async=1:first_pts=0,' + filter + 'asetpts=PTS-STARTPTS,apad',
          inputs: audio_input,
          outputs: 'out' + i
        })
      }
    }

    if ( complexFilter.length > 0 ) {
      ffmpeg_command.complexFilter(complexFilter)
    }
    ffmpeg_command.addOutputOption('-map', video_output + ':v')

    // Stream map will handle the audio track default/grouping
    var var_stream_map = 'v:0,agroup:aac'
    for (var i=0; i<audio_present.length; i++) {
      if ( audio_reencoded.indexOf(audio_present[i]) > -1 ) {
        audio_output = '[out' + i + ']'
      } else {
        audio_output = audio_present[i] + ':a:0'
      }
      ffmpeg_command.addOutputOption('-map', audio_output)
      var_stream_map += ' a:' + i + ',agroup:aac,language:ENG'
      if ( i == 0 ) {
        var_stream_map += ',default:yes'
      }
    }

    // Default to keep only 1 minute of segments on disk, unless dvr is specified
    var hls_list_size = 60 / SECONDS_PER_SEGMENT
    var delete_segments = 'delete_segments+'
    if ( dvr ) {
      hls_list_size = 0
      delete_segments = ''
    }

    if ( stream_count > 1 ) {
      // Only re-encode video if there is more than 1 video stream
      let bandwidth = 1040 * stream_count
      ffmpeg_command.addOutputOption('-c:v', ffmpegEncoder)
      .addOutputOption('-pix_fmt:v', 'yuv420p')
      .addOutputOption('-r:v', '30')
      .addOutputOption('-b:v', bandwidth.toString() + 'k')
    } else {
      // If only 1 video stream, just copy the video without re-encoding
      ffmpeg_command.addOutputOption('-c:v', 'copy')
    }
    if ( ffmpegEncoder == defaultEncoder ) {
      // If using software encoder, add preset to reduce CPU usage
      ffmpeg_command.addOutputOption('-preset:v', 'superfast')
    } else if ( ffmpegEncoder == 'h264_v4l2m2m' ) {
      // Otherwise if using this Linux hardware encoder, set some additional variables
      // per https://www.willusher.io/general/2020/11/15/hw-accel-encoding-rpi4
      ffmpeg_command.addOutputOption('-num_output_buffers', '32')
      .addOutputOption('-num_capture_buffers', '16')
    }

    // Audio again: check which audio tracks need re-encoding, and which can simply be copied
    for (var i=0; i<audio_present.length; i++) {
      if ( audio_reencoded.indexOf(audio_present[i]) > -1 ) {
        audio_encoder = 'aac'
      } else {
        audio_encoder = 'copy'
      }
      ffmpeg_command.addOutputOption('-c:a:' + i, audio_encoder)
      if ( park_audio ) {
        ffmpeg_command.addOutputOption('-ac:a:' + i, '1')
      }
    }
    // Drop subtitles/captions
    // End after 6 hours in case we forget to stop it manually
    // Set HLS parameters
    ffmpeg_command.addOutputOption('-sn')
    .addOutputOption('-t', '6:00:00')
    .addOutputOption('-f', 'hls')
    .addOutputOption('-hls_time', SECONDS_PER_SEGMENT)
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
    .on('start', function(commandLine) {
      session.log('multiview stream started')
      ffmpeg_status = true
      if ( argv.debug || argv.ffmpeg_logging ) {
        session.log('multiview stream command: ' + commandLine)
      }
    })
    .on('error', function(err, stdout, stderr) {
      session.log('multiview stream stopped: ' + err.message)
      ffmpeg_status = false
      if ( stdout ) session.log(stdout)
      if ( stderr ) session.log(stderr)
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

// Listen for Kodi STRM file requests
app.get('/kodi.strm', async function(req, res) {
  if ( ! (await protect(req, res)) ) return

  try {
    session.requestlog('kodi.strm', req)

    let server = 'http://' + req.headers.host

    let video_url = '/stream.m3u8'
    let file_name = 'kodi'
    if ( req.query.src ) {
      video_url = req.query.src
    } else {
      let urlArray = req.url.split('?')
      if ( (urlArray.length == 2) ) {
        video_url += '?' + urlArray[1]
        let paramArray = urlArray[1].split('=')
        for (var i=1; i<paramArray.length; i++) {
          let param = paramArray[i].split('&')
          file_name += '.' + param[0]
        }
      }
      video_url = server + video_url
    }

    var inputstream_property_name = 'inputstreamaddon'
    if ( req.query.version && (req.query.version == '18') ) {
      inputstream_property_name = 'inputstream.adaptive'
    }

    var body = '#KODIPROP:mimetype=application/vnd.apple.mpegurl' + "\n" + '#KODIPROP:' + inputstream_property_name + '=inputstream.adaptive' + "\n" + '#KODIPROP:inputstream.adaptive.manifest_type=hls' + "\n" + video_url

    var download_headers = {
      'Content-Disposition': 'attachment; filename="' + file_name + '.strm"'
    }
    res.writeHead(200, download_headers)

    res.end(body)
  } catch (e) {
    session.log('kodi.strm request error : ' + e.message)
    res.end('kodi.strm request error, check log')
  }
})
