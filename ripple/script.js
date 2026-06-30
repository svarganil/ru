Splitting();

$('.signup').submit(function(event){
 event.preventDefault();
 var emailText = $('.email').val();
 $("svg foreignObject").append('<div data-splitting="chars">' + emailText + "</div>");
  Splitting();
  $("span.char:first-of-type").unwrap();
  var t = 40 - ($(".char").length);
  console.log(t);
  for (let j = 0; j < t; j++) {
    $("svg foreignObject div").append('<span class="char empty"></span>');
  }
  $(".char").append('<div></div>');
  $("body").addClass("submitted");
  setTimeout(function(){	
    $('foreignObject span').remove();
    $('.email').val('');
    $("body").removeClass("submitted");
}, 16000);
});