document.querySelectorAll("div.entry").forEach(post => {
    var commentBtn = post.querySelector('a.comments');
    if (commentBtn && commentBtn.href)
        post.querySelector('a.title').href = commentBtn.href;
})

console.log('URLs fixed');