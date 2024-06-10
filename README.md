# mlbserver

Current version 2024.06.10

Credit to https://github.com/tonycpsu/streamglob and https://github.com/mafintosh/hls-decryptor

## Installation

### node-cli
```
npm install -g mlbserver
```

### docker
```
docker pull tonywagner/mlbserver
```


## Launch

### node-cli (follow the prompts on first run, or see below for possible command line options)
```
mlbserver
```
or in application directory:
```
node index.js
```

### docker-compose
Update the environment variables below and save it as docker-compose.yml:
```
version: "3"
services:
  mlbserver:
    image: tonywagner/mlbserver:latest
    container_name: mlbserver
    environment:
      - TZ=America/New York
      - data_directory=/mlbserver/data_directory
      - account_username=your.account.email@example.com
      - account_password=youraccountpassword
      - zip_code=0
      - fav_teams=0
      #- zip_code=00000
      #- country=USA
      #- fav_teams=ARI,ATL
      #- debug=false
      #- port=9999
      #- multiview_port=10000
      #- multiview_path=
      #- ffmpeg_path=
      #- ffmpeg_encoder=
      #- page_username=
      #- page_password=
      #- content_protect=
      #- gamechanger_delay=0
    ports:
      - 9999:9999
      - 10000:10000
    volumes:
      - /mlbserver/data_directory
```
Then launch it with ```docker-compose up --detach```

### docker-cli
Update the environment variables in the command below and run it:
```
docker run -d \
  --name mlbserver \
  --env TZ="America/New_York" \
  --env data_directory=/mlbserver/data_directory \
  --env account_username=your.account.email@example.com \
  --env account_password=youraccountpassword \
  --env zip_code=0 \
  --env fav_teams=0 \
  -p 9999:9999 \
  -p 10000:10000 \
  --volume /mlbserver/data_directory \
  tonywagner/mlbserver
```
Subsequent runs can be launched with ```docker start mlbserver```

Docker installs may require further configuration to get multiview streaming to work.


## Usage

After launching the server or Docker container, you can access it at http://localhost:9999 on the same machine, or substitute your computer's IP address for localhost to access it from a different device. Load that address in a web browser to start using the server and to see more documentation.

Basic command line or Docker environment options:

```
--port or -p (primary port to run on; defaults to 9999 if not specified)
--debug or -d (false if not specified)
--version or -v (returns package version number)
--logout or -l (logs out and clears session)
--session or -s (clears session)
--cache or -c (clears cache)
--env or -e (use environment variables instead of command line arguments; necessary for Docker)
```

Advanced command line or Docker environment options:

```
--account_username (email address, default will use stored credentials or prompt user to enter them)
--account_password (default will use stored credentials or prompt user to enter them)
--zip_code (optional, for USA blackout labels, will prompt if not set or stored)
--country (optional, for international blackout labels -- see list of accepted names in session.js -- defaults to USA if not set or stored)
--fav_teams (optional, comma-separated list of favorite team abbreviations from https://github.com/tonywagner/mlbserver/blob/master/session.js#L26 -- will prompt if not set or stored)
--free (optional, highlights free games)
--multiview_port (port for multiview streaming; defaults to 1 more than primary port, or 10000)
--multiview_path (where to create the folder for multiview encoded files; defaults to app directory)
--ffmpeg_path (path to ffmpeg binary to use for multiview encoding; default downloads a binary using ffmpeg-static)
--ffmpeg_encoder (ffmpeg video encoder to use for multiview; default is the software encoder libx264)
--ffmpeg_logging (if present, logs all ffmpeg output -- useful for checking encoding speed or troubleshooting)
--page_username (username to protect pages; default is no protection)
--page_password (password to protect pages; default is no protection)
--content_protect (specify the content protection key to include as a URL parameter, if page protection is enabled)
--gamechanger_delay (specify extra delay for the gamechanger switches in 10 second increments, default is 0)
```

For multiview, the default software encoder is limited by your CPU. You may want to experiment with different ffmpeg hardware encoders. "h264_videotoolbox" is confirmed to work on supported Macs, and "h264_v4l2m2m" is confirmed to work on a Raspberry Pi 4 (and likely other Linux systems) when ffmpeg is compiled with this patch: https://www.raspberrypi.org/forums/viewtopic.php?p=1780625#p1780625

More potential hardware encoders are described at https://stackoverflow.com/a/50703794

```
h264_amf to access AMD gpu, (windows only)
h264_nvenc use nvidia gpu cards (work with windows and linux)
h264_omx raspberry pi encoder
h264_qsv use Intel Quick Sync Video (hardware embedded in modern Intel CPU)
h264_v4l2m2m use V4L2 Linux kernel api to access hardware codecs
h264_vaapi use VAAPI which is another abstraction API to access video acceleration hardware (Linux only)
h264_videotoolbox use videotoolbox an API to access hardware on OS X
```

## License

MIT
