var xjs = require('xjs');
var App = new xjs.App();

window.onload = init;

var isXsplit = false;

var xhr = new XMLHttpRequest();

var timestampOld=0;
var timestamp=0;
var cacheBusterValiable=Date.now();
var cacheBuster=0;

var firstupdate = true;

var scObj;

var currPlayer1;
var currPlayer2;

var currTeam1;
var currTeam2;

var currScore1;
var currScore2;

var animating = 0;

var switchCount = 0;
var currPlayerElement = "pName";

var isPreview = false;

function init() {
    //アニメーションは、基本init()内部で GSAP の TweenMax を用いて描写。
    xjs.ready().then(xjs.Source.getCurrentSource).then(function(curItem) {
        var sourceWindow = xjs.SourcePluginWindow.getInstance();
        App.getVersion().then(function(res) {
            var version = res;
            console.log(version);
        });
        isXsplit = true;

        XJSitem = curItem;

        XJSitem.setBrowserCustomSize(xjs.Rectangle.fromDimensions(1280,48));
        XJSitem.setPosition(xjs.Rectangle.fromCoordinates(0,0,1,0.0666666666666667));
        XJSitem.setPositionLocked(true);

        XJSitem.getView().then(function(view) {
            console.log("view:" +view);
            if (view != 0) {
                isPreview = true;
            }
        });

        App.getTransition().then(function(res) {
            var currTransition = res._value;
            console.log(currTransition);
            if (currTransition.indexOf(".webm") == -1 ){
                setTimeout(update,300);
            } else {
                var transitionDuration = currTransition.split('.webm,')[1] / 10000 ;
                if (!transitionDuration) {
                    transitionDuration = 2000;
                }
                console.log(transitionDuration);
                setTimeout(update,transitionDuration);
            }
        });
    });


    //TweenMax の引数について： http://qiita.com/ANTON072/items/a1302f4761bf0ffcf525
    TweenMax.to('#board1', 0.3, {
        top:"0px",
        repeat:0,
        ease: Power2.Linear,
        delay: 0,
        yoyo:false
    });
    TweenMax.to('#board2', 0.6, {
        top:"0px",
        repeat:0,
        ease: Power3.Linear,
        delay: 0.1,
        yoyo:false
    });
    TweenMax.to('#board3', 0.8, {
        left:"210px",
        repeat:0,
        ease: Power2.easeOut,
        delay: 0.7,
        yoyo:false
    });
    TweenMax.to('#board4', 0.8, {
        left:"-210px",
        repeat:0,
        ease: Power2.easeOut,
        delay: 0.7,
        yoyo:false
    });
    TweenMax.to('#board5', 0.3, {
        top:"0px",
        repeat:0,
        ease: Power2.Linear,
        delay: 0,
        yoyo:false
    });

    //真下の行は、Xsplit専用の式。Xsplitでhtmlを60fpsとするのに必要。
    //ブラウザで動作チェックする分には、コメントアウトして頂いて問題ナッシング
    if (isXsplit) {
        window.external.SetLocalProperty("prop:Browser60fps","1");
    }

    //以下から普通に必要な式
    xhr.overrideMimeType('application/json');
    
	xhr.onreadystatechange = scLoaded;
	pollHandler();
	setInterval(function() {
		pollHandler();
	}, 500);
}

function pollHandler() {
	xhr.open('GET', "streamcontrol.json?"+cacheBusterValiable+"="+cacheBuster,true);
	xhr.send();
	cacheBuster++;
}

function switchTagTwitter(){
    switch (currPlayerElement) {
        case 'pName':
            if (scObj["pTwitter1"] || scObj["pTwitter2"]) {
                currPlayerElement = 'pTwitter';
            }
            break;
        case 'pTwitter':
            currPlayerElement = 'pName';
            break;
    }
    if (scObj["pTwitter1"] && currPlayerElement == 'pTwitter' || document.getElementById("player1").innerHTML != currPlayer1) {
        TweenMax.to(document.getElementById("player1"),0.5,{opacity:0,ease:Quad.easeIn,onComplete: function() {
            document.getElementById("player1").innerHTML = scObj[currPlayerElement + "1"].toString().toUpperCase();
            textFit(document.getElementsByClassName('player1'), {minFontSize:14, maxFontSize: 20,multiLine: false});
        }});
        TweenMax.to(document.getElementById("player1"),0.5,{opacity:1,ease:Quad.easeOut,delay:0.5});
    }
    
    if (scObj["pTwitter2"] && currPlayerElement == 'pTwitter' || document.getElementById("player2").innerHTML != currPlayer2) {
        TweenMax.to(document.getElementById("player2"),0.5,{opacity:0,ease:Quad.easeIn,onComplete: function() {
            document.getElementById("player2").innerHTML = scObj[currPlayerElement + "2"].toString().toUpperCase();
            textFit(document.getElementsByClassName('player2'), {minFontSize:14, maxFontSize: 20,multiLine: false});
        }});
        TweenMax.to(document.getElementById("player2"),0.5,{opacity:1,ease:Quad.easeOut,delay:0.5});
    }
    switchCount = 0;
}

function scLoaded() {
    
	if (xhr.readyState === 4) {
        
		scObj = JSON.parse(xhr.responseText);
        
		timestampOld = timestamp;
		timestamp = scObj["timestamp"];
		//console.log(timestamp);
        if ((timestamp != timestampOld && animating == 0) || firstupdate) {
            update();
        } else if(animating == 0 && switchCount > 10) {
            switchTagTwitter();
        } else {
            switchCount++;
        }
	}
}

function update() {
    
	var datetime = new Date();
	var unixTime = Math.round(datetime.getTime()/1000);

	if (firstupdate) {
		animating++;

		document.getElementById("scoreboardintro").play();
        document.getElementById("scoreboardintro").onended = function() {};
        
        currPlayer1 = scObj["pName1"].toString();
        currPlayer2 = scObj["pName2"].toString();
            
        document.getElementById("player1").innerHTML = currPlayer1;
        document.getElementById("player2").innerHTML = currPlayer2;

        currTeam1 = scObj["pTeam1"].toString();
        currTeam2 = scObj["pTeam2"].toString();
            
        document.getElementById("team1").innerHTML = currTeam1;
        document.getElementById("team2").innerHTML = currTeam2;

        currScore1 = scObj["pScore1"];
        currScore2 = scObj["pScore2"];
        currBestOf = scObj["bestOf"];
        document.getElementById("score1").innerHTML = "<img src='imgs/"+ currScore1 +"b.png' style='position:absolute; top:10px; left:20px;'>";
        document.getElementById("score2").innerHTML = "<img src='imgs/"+ currScore2 +"r.png' style='position:absolute; top:10px; left:20px;'>";

        document.getElementById('stage').innerHTML = scObj['stage'] + "<br>" + scObj['bestOf'];


        TweenMax.from(document.getElementById("player1"),0.5,{x:"+50",opacity:0,delay:1.5});
        TweenMax.from(document.getElementById("player2"),0.5,{x:"-50",opacity:0,delay:1.5});

        TweenMax.from(document.getElementById("team1"),0.5,{x:"+50",opacity:0,delay:1.5});
        TweenMax.from(document.getElementById("team2"),0.5,{x:"-50",opacity:0,delay:1.5});

        TweenMax.from(document.getElementById("score1"),0.5,{opacity:0,delay:1.5});
        TweenMax.from(document.getElementById("score2"),0.5,{opacity:0,delay:1.5});

        loadFlags();

        TweenMax.from(document.getElementById("flag1"),0.5,{opacity:0,delay:1.5});
        TweenMax.from(document.getElementById("flag2"),0.5,{opacity:0,delay:1.5});

        TweenMax.from(document.getElementById('stage'),0.5,{opacity:0,delay:1.5,onComplete:function(){animating--;}});

        document.getElementById("container").style.display="block";
        textFit(document.getElementsByClassName('stage'), {minFontSize:10, maxFontSize: 14,multiLine: true});

        textFit(document.getElementsByClassName('player1'), {minFontSize:14, maxFontSize: 20,multiLine: false});
        textFit(document.getElementsByClassName('player2'), {minFontSize:14, maxFontSize: 20,multiLine: false});

        firstupdate = false;

    } else if (animating == 0) {

		if (currCountry1 != getCountry(scObj["pCountry1"].toString()) || currCountry2 != getCountry(scObj["pCountry2"].toString())) {
            animating++;
			TweenMax.to(document.getElementById("flags"),1,{opacity:0,onComplete: function() {
				loadFlags();
			}});
			TweenMax.to(document.getElementById("flags"),1,{opacity:1,delay:1,onComplete:function(){animating--;}});
		}

		if (currPlayer1 != scObj["pName1"].toString() || currPlayer2 != scObj["pName2"].toString()) {
            animating++;

    		TweenMax.to(document.getElementById("player1"),0.5,{x:"+50",opacity:0,ease:Quad.easeIn,onComplete: function() {
                currPlayer1 = scObj["pName1"].toString();
                document.getElementById("player1").innerHTML = currPlayer1;
                textFit(document.getElementsByClassName('player1'), {minFontSize:14, maxFontSize: 20,multiLine: false});
            }});
            TweenMax.to(document.getElementById("player1"),0.5,{x:"-0",opacity:1,ease:Quad.easeOut,delay:0.5});

    		TweenMax.to(document.getElementById("player2"),0.5,{x:"-50",opacity:0,ease:Quad.easeIn,onComplete: function() {
                currPlayer2 = scObj["pName2"].toString();
                document.getElementById("player2").innerHTML = currPlayer2;
                textFit(document.getElementsByClassName('player2'), {minFontSize:14, maxFontSize: 20,multiLine: false});
            }});
            TweenMax.to(document.getElementById("player2"),0.5,{x:"+0",opacity:1,ease:Quad.easeOut,delay:0.5,onComplete:function(){
                animating--;
            }});

            switchCount = 0;
            currPlayerElement = "pName";
    	}

        if (currTeam1 != scObj["pTeam1"].toString() || currTeam2 != scObj["pTeam2"].toString()) {
            animating++;

    		TweenMax.to(document.getElementById("team1"),0.5,{x:"+50",opacity:0,ease:Quad.easeIn,onComplete: function() {
                currTeam1 = scObj["pTeam1"].toString();
                document.getElementById("team1").innerHTML = currTeam1;
                textFit(document.getElementsByClassName('team1'), {minFontSize:14, maxFontSize: 20,multiLine: false});
            }});
            TweenMax.to(document.getElementById("team1"),0.5,{x:"-0",opacity:1,ease:Quad.easeOut,delay:0.5});

    		TweenMax.to(document.getElementById("team2"),0.5,{x:"-50",opacity:0,ease:Quad.easeIn,onComplete: function() {
                currTeam2 = scObj["pTeam2"].toString();
                document.getElementById("team2").innerHTML = currTeam2;
                textFit(document.getElementsByClassName('team2'), {minFontSize:14, maxFontSize: 20,multiLine: false});
            }});
            TweenMax.to(document.getElementById("team2"),0.5,{x:"+0",opacity:1,ease:Quad.easeOut,delay:0.5,onComplete:function(){
                animating--;
            }});

            switchCount = 0;
    	}

        if (currScore1 != scObj["pScore1"].toString() || currBestOf != scObj["bestOf"]) {
            animating++;
            currScore1 = scObj['pScore1'].toString();
            TweenMax.to(document.getElementById('score1'),0.5,{opacity:0,ease:Quad.easeIn,onComplete: function() {
                document.getElementById("score1").innerHTML = "<img src='imgs/"+ currScore1 +"b.png'>";
            }});
            TweenMax.to(document.getElementById('score1'),0.5,{opacity:1,ease:Quad.easeOut,delay:0.5,onComplete: function(){
                animating--;
            }});
        }
        if (currScore2 != scObj["pScore2"].toString() || currBestOf != scObj["bestOf"]) {
            animating++;
            currScore2 = scObj['pScore2'].toString();
            currBestOf = scObj['bestOf'];
            TweenMax.to(document.getElementById('score2'),0.5,{opacity:0,ease:Quad.easeIn,onComplete: function() {
                document.getElementById("score2").innerHTML = "<img src='imgs/"+ currScore2 +"r.png'>";
            }});
            TweenMax.to(document.getElementById('score2'),0.5,{opacity:1,ease:Quad.easeOut,delay:0.5,onComplete: function(){
                animating--;
            }});
        }

        if (document.getElementById('stage').innerHTML != scObj['stage'] + "<br>" + scObj['bestOf']) {
            animating++;
            TweenMax.to(document.getElementById('stage'),0.5,{opacity:0,ease:Quad.easeIn,onComplete: function() {
                document.getElementById('stage').innerHTML = scObj['stage'] + "<br>" + scObj['bestOf'];
                textFit(document.getElementsByClassName('stage'), {minFontSize:10, maxFontSize: 14,multiLine: false});
            }});
            TweenMax.to(document.getElementById('stage'),0.5,{opacity:1,delay:0.5,ease:Quad.easeOut,onComplete: function(){
                animating--;
            }});
        }
	}
}

function loadFlags() {
    currCountry1 = getCountry(scObj["pCountry1"].toString());
    currCountry2 = getCountry(scObj["pCountry2"].toString());

    document.getElementById("flag1").src = currCountry1
        ? "GoSquared/expanded/" + currCountry1 + ".png"
        : "GoSquared/expanded/transparent.png";

    document.getElementById("flag2").src = currCountry2
        ? "GoSquared/expanded/" + currCountry2 + ".png"
        : "GoSquared/expanded/transparent.png";
}

function getCountry (country) {

	var count = iso.findCountryByName(country);
	if (!count)
		count = iso.findCountryByCode(country);
	if (!count) {
		var count = new Array();
		count['value'] = country;
	}

	return count['value'];
}