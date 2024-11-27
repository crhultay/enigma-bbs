#!/usr/bin/env bash

{ # this ensures the entire script is downloaded before execution
ENIGMA_BRANCH=${ENIGMA_BRANCH:=master}
ENIGMA_INSTALL_DIR=${ENIGMA_INSTALL_DIR:=$HOME/enigma-bbs}
ENIGMA_SOURCE=${ENIGMA_SOURCE:=https://github.com/NuSkooler/enigma-bbs.git}
ENIGMA_INSTALL_LOG=~/enigma-install.log
TIME_FORMAT=`date "+%Y-%m-%d %H:%M:%S"`

# ANSI Codes
RESET="\e[0m"
BOLD="\e[1m"
UNDERLINE="\e[4m"
INVERSE="\e7m"
FOREGROUND_BLACK="\e[30m"
FOREGROUND_RED="\e[31m"
FOREGROUND_GREEN="\e[32m"
FOREGROUND_YELLOW="\e[33m"
FOREGROUND_BLUE="\e[34m"
FOREGROUND_MAGENTA="\e[35m"
FOREGROUND_CYAN="\e[36m"
FOREGROUND_WHITE="\e[37m"
BACKGROUND_BLACK="\e[40m"
BACKGROUND_RED="\e[41m"
BACKGROUND_GREEN="\e[42m"
BACKGROUND_YELLOW="\e[43m"
BACKGROUND_BLUE="\e[44m"
BACKGROUND_MAGENTA="\e[45m"
BACKGROUND_CYAN="\e[46m"
BACKGROUND_WHITE="\e[47m"
FOREGROUND_STRONG_WHITE="\e[90m"
FOREGROUND_STRONG_RED="\e[91m"
FOREGROUND_STRONG_GREEN="\e[92m"
FOREGROUND_STRONG_YELLOW="\e[93m"
FOREGROUND_STRONG_BLUE="\e[94m"
FOREGROUND_STRONG_MAGENTA="\e[95m"
FOREGROUND_STRONG_CYAN="\e[96m"
FOREGROUND_STRONG_WHITE="\e[97m"
BACKGROUND_STRONG_BLACK="\e[100m"
BACKGROUND_STRONG_RED="\e[101m"
BACKGROUND_STRONG_GREEN="\e[102m"
BACKGROUND_STRONG_YELLOW="\e[103m"
BACKGROUND_STRONG_BLUE="\w[104m"
BACKGROUND_STRONG_MAGENTA="\e[105m"
BACKGROUND_STRONG_CYAN="\e[106m"
BACKGROUND_STRONG_WHITE="\e[107m"

enigma_header() {
    clear
    echo -e "$FOREGROUND_STRONG_WHITE"
    cat << EndOfMessage
                                                                 ______
_____________________   _____  ____________________    __________\\_   /
\\__   ____/\\_ ____   \\ /____/ /   _____ __         \\  /   ______/ // /___jp!
 //   __|___//   |    \\//   |//   |    \\//  |  |    \\//        \\ /___   /_____
/____       _____|      __________       ___|__|      ____|     \\   /  _____  \\
---- \\______\\ -- |______\\ ------ /______/ ---- |______\\ - |______\\ /__/ // ___/
                                                                       /__   _\\
       <*> ENiGMA½ // https://github.com/NuSkooler/enigma-bbs <*>        /__/


ENiGMA½:
  Source     : ${ENIGMA_SOURCE} (${ENIGMA_BRANCH} branch)
  Destination: ${ENIGMA_INSTALL_DIR}

EndOfMessage
    echo -e "$RESET"
}

fatal_error() {
    echo -e "${TIME_FORMAT} \e[41mERROR:\033[0m %b\n" "$*" >&2;
    exit 1
}

check_exists() {
    command -v $1 >/dev/null 2>&1 ;
}

enigma_install_needs_ex() {
    echo -ne "${FOREGROUND_GREEN}Checking for '$1'...${RESET}"
    if check_exists $1 ; then
        echo -e "${FOREGROUND_STRONG_GREEN} Found!${RESET}"
    else
        echo ""
        fatal_error "${FOREGROUND_STRONG_RED}ENiGMA½ requires '$1' but it was not found. Please install it and/or make sure it is in your path then restart the installer.\n\n$2${RESET}"
    fi
}

enigma_install_needs() {
    enigma_install_needs_ex $1 "Examples:\n  sudo apt install $1 # Debian/Ubuntu\n  sudo yum install $1 # CentOS"
}

enigma_has_mise() {
    echo -e "${FOREGROUND_GREEN}Checking for an installation of mise-en-place (https://mise.jdx.dev/)${RESET}"
    if check_exists "mise"; then
        echo -e "${FOREGROUND_STRONG_GREEN} Found!${RESET}"
    else
        echo ""
        fatal_error "${FOREGROUND_STRONG_RED}ENiGMA½ requires mise-enplace to install dependencies.${RESET}"
    fi
}

log()  {
    echo -e "${TIME_FORMAT} %b\n" "$*";
}

enigma_install_init() {
    enigma_install_needs git
    enigma_install_needs curl
    enigma_install_needs_ex make "Examples:\n  sudo apt install build-essential # Debian/Ubuntu\n  sudo yum groupinstall 'Development Tools' # CentOS"
    enigma_install_needs make
    enigma_install_needs gcc
}

install_mise_en_place() {
    curl https://mise.run | sh

    # ~/.local/bin/mise activate bash >> bash
    eval "$(~/.local/bin/mise activate bash)"

    cd $ENIGMA_INSTALL_DIR

    mise install >> ${ENIGMA_INSTALL_LOG}

    export PATH="$HOME/.local/share/mise/shims:$PATH"
}

install_tools() {
    # Used to read toml files from bash scripts
    python -m pip install toml-cli
}

download_enigma_source() {
    local INSTALL_DIR
    INSTALL_DIR=${ENIGMA_INSTALL_DIR}

    if [ -d "$INSTALL_DIR/.git" ]; then
        log "${FOREGROUND_YELLOW}ENiGMA½ is already installed in $INSTALL_DIR, trying to update using git...${RESET}"
        command git --git-dir="$INSTALL_DIR"/.git --work-tree="$INSTALL_DIR" fetch 2> /dev/null ||
            fatal_error "${FOREGROUND_STRONG_RED}Failed to update ENiGMA½, run 'git fetch' in $INSTALL_DIR yourself.${RESET}"
    else
        log "${FOREGROUND_GREEN}Downloading ENiGMA½ from git to '$INSTALL_DIR'${RESET}"
        mkdir -p "$INSTALL_DIR"
        command git clone ${ENIGMA_SOURCE} "$INSTALL_DIR" ||
            fatal_error "${FOREGROUND_STRONG_RED}Failed to clone ENiGMA½ repo. Please report this!${RESET}"
    fi
}

is_arch_arm() {
    local ARCH=`arch`
    if [[ $ARCH == "arm"* ]]; then
        true
    else
        false
    fi
}

extra_npm_install_args() {
    if is_arch_arm ; then
        echo "--build-from-source"
    else
        echo ""
    fi
}

install_node_packages() {
    log "${FOREGROUND_GREEN}Installing required Node packages...${RESET}"
    log "${FOREGROUND_YELLOW}Note that on some systems such as RPi, this can take a VERY long time. Be patient!${RESET}"

    cd ${ENIGMA_INSTALL_DIR}
    local EXTRA_NPM_ARGS=$(extra_npm_install_args)
    git checkout ${ENIGMA_BRANCH}

    npm install ${EXTRA_NPM_ARGS} >> $ENIGMA_INSTALL_LOG
    if [ $? -eq 0 ]; then
        log "${FOREGROUND_STRONG_GREEN}npm package installation complete${RESET}"
    else
        fatal_error "${FOREGROUND_STRONG_RED}Failed to install ENiGMA½ npm packages. Please report this and refer to ~/enigma-install.log!{$RESET}"
    fi
}

copy_template_files() {
    log "${FOREGROUND_GREEN}Copying Template Files to ${ENIGMA_INSTALL_DIR}/misc/gophermap${RESET}"
    echo $ENIGMA_INSTALL_DIR
    if [[ ! -f "$ENIGMA_INSTALL_DIR/gopher/gophermap" ]]; then
        cp "$ENIGMA_INSTALL_DIR/misc/gophermap" "$ENIGMA_INSTALL_DIR/gopher/gophermap"
    fi
}

enigma_footer() {
    log "ENiGMA½ installation complete!"
    echo -e "${FOREGROUND_YELLOW}"
    cat << EndOfMessage

ADDITIONAL ACTIONS ARE REQUIRED!
--------------------------------

1 - If you did not have Node.js and/or NVM installed previous to this please open a new shell/terminal now!
  (!) Not doing so will prevent 'nvm' or 'node' commands from functioning!

2 - If this is the first time you've installed ENiGMA½, you now need to generate a minimal configuration:

  cd ${ENIGMA_INSTALL_DIR}
  ./oputil.js config new

3 - Additionally, a minimum of the following support binaires are recommended:
  7zip: Archive support
    Debian/Ubuntu : apt-get install p7zip
    CentOS        : yum install p7zip

  Lha: Archive support
    Debian/Ubuntu : apt-get install lhasa

  Arj: Archive support
    Debian/Ubuntu : apt-get install arj

  sz/rz: Various X/Y/Z modem support
    Debian/Ubuntu : apt-get install lrzsz
    CentOS        : yum install lrzsz

  See docs for more information including other useful binaries!

4 - Start ENiGMA½ BBS!

    ./autoexec.sh

5 - Enable Automated Startup on Boot (optional)

    Create a file in /etc/systemd/system/bbs.service with the following contents:
        [Unit]
        Description=Enigma½ BBS
        
        [Install]
        WantedBy=multi-user.target
        
        [Service]
        ExecStart=/home/<YOUR_USERNAME>/enigma-bbs/autoexec.sh
        Type=simple
        User=<YOUR_USERNAME>
        Group=<YOUR_USERNAME>
        WorkingDirectory=/home/<YOUR_USERNAME>/enigma-bbs/
        Restart=on-failure

    Run 'sudo systemctl enable bbs.service'

EndOfMessage
    echo -e "${RESET}"
}

post_install() {
    MISE_SHIM_PATH_COMMAND='export PATH="$HOME/.local/share/mise/shims:$PATH"'
    if grep -Fxq "$MISE_SHIM_PATH_COMMAND" ~/.bashrc
    then
        log "${FOREGROUND_STRONG_GREEN}Mise Shims found in your ~/.bashrc${RESET}"
    else
        echo $MISE_SHIM_PATH_COMMAND >> ~/.bashrc
        log "${FOREGROUND_STRONG_YELLOW}Installed Mise Shims into your ~/.bashrc${RESET}"
    fi
}

install_dependencies() {
    log "${FOREGROUND_GREEN}Installing Dependencies...$RESET"

    enigma_install_init
    install_mise_en_place
    install_tools
    install_node_packages
    post_install
}

install_bbs() {
    log "${FOREGROUND_GREEN}Installing ENiGMA½...$RESET"

    download_enigma_source
    copy_template_files
}

install_everything() {
    log "${FOREGROUND_STRONG_GREEN}Installing Everything...$RESET"
    download_enigma_source
    install_dependencies
    copy_template_files
}

menu() {
    title="Installation Options"
    prompt="Pick an option:"
    options=(
        "Install Dependencies"
        "Install ENiGMA½"
        "Install Everything"
    )

    echo "$title"
    PS3="$prompt "
    select opt in "${options[@]}" "Quit"; do
        case "$REPLY" in
        1) enigma_install_init; install_dependencies; break;;
        2) install_bbs; break;;
        3) enigma_install_init; install_everything; break;;
        $((${#options[@]}+1))) echo "Goodbye!"; exit 0;;
        *) echo -e "${FOREGROUND_STRONG_RED}Invalid option.${RESET}";continue;;
        esac
    done < /dev/tty

    unset PS3
}

# Reset Logfile
rm $ENIGMA_INSTALL_LOG

enigma_header
menu
enigma_footer

} # this ensures the entire script is downloaded before execution
